// The whole journey an attachment takes through a thread, through the real
// routes.
//
// The five things this pins are the five that would each be a quiet lie:
//   - a photo sent with no caption is a message, and its bytes land on the
//     conversation's own serving key, EXIF stripped by the shared journey;
//   - a scan that REFUSED leaves nothing on that key and nothing in the thread,
//     while a scan that could not RUN never closes the composer;
//   - the bytes are readable by the two participants and by nobody else, and a
//     reported photo stops being readable by either;
//   - a shared pub stores an id and nothing that could locate a person, and its
//     card is resolved live rather than frozen at send time;
//   - a message with neither words nor an attachment is still refused.

import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limitState.limited };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

// The curated index reads a build artifact off disk. The card policy itself is
// unit-tested in messageAttachments.test.ts; here the lookup is a fixture so the
// route test stays about the route.
const venueState = vi.hoisted(() => ({
  found: true,
  kind: "pub" as string,
  cheapestPrice: 5.4 as number | null,
  name: "The Coach and Horses",
}));
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) =>
      venueState.found
        ? {
            status: "found" as const,
            canonicalId: id,
            venue: { id, name: venueState.name, borough: "Soho", lat: 51.5, lng: -0.13 },
            slimVenue: {
              id,
              name: venueState.name,
              lat: 51.5,
              lng: -0.13,
              borough: "Soho",
              cheapestPrice: venueState.cheapestPrice,
              kind: venueState.kind,
            },
          }
        : { status: "unknown" as const, canonicalId: id },
  };
});

import { POST as POST_INBOX } from "@/app/api/messages/route";
import {
  GET as GET_THREAD,
  POST as POST_THREAD,
} from "@/app/api/messages/[id]/route";
import { GET as GET_PHOTO } from "@/app/api/messages/[id]/photo/[messageId]/route";
import { messagePhotoServingKey, messagePhotoStagingKey } from "@/lib/messageAttachments";
import type { MessagePhotoStorage } from "@/lib/messagePhotoMedia.server";
import {
  __setMessagePhotoRouteDepsForTest,
} from "@/lib/messagePhotoRoute.server";
import {
  __setMessagePhotoServeRouteDepsForTest,
} from "@/lib/messagePhotoServeRoute.server";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetPintDrops } from "@/lib/pintDrops";

const BASE = "http://localhost/api/messages";
const VENUE = "ldn-coach-and-horses";

function asUser(userId: string): void {
  authState.userId = userId;
}

async function jpeg(): Promise<File> {
  const bytes = await sharp({
    create: { width: 1200, height: 1500, channels: 3, background: "#2b1d14" },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "pint.jpg", { type: "image/jpeg" });
}

/** A JPEG with a fake GPS block, to prove the shared strip step really runs. */
async function jpegWithFakeGps(): Promise<File> {
  const base = await sharp({
    create: { width: 900, height: 1100, channels: 3, background: "#31485f" },
  })
    .jpeg()
    .toBuffer();
  const payload = Buffer.from("Exif\0\0FAKE-GPS-LAT-51.5074-LON-0.1278", "binary");
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return new File([Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)])], "geo.jpg", {
    type: "image/jpeg",
  });
}

function memoryStorage(): MessagePhotoStorage & {
  objects: Map<string, Buffer>;
  keys: () => string[];
} {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    keys: () => [...objects.keys()],
    async upload(path, bytes) {
      objects.set(path, Buffer.from(bytes));
    },
    // Promotion proves its own write through this, so the fake answers like a
    // bucket: absent, unreadable, or the bytes it was handed.
    async readBack(path) {
      const bytes = objects.get(path);
      if (!bytes) return { ok: false, failure: "storage_error", detail: "Object not found" };
      if (!bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        return { ok: false, failure: "magic_bytes_mismatch", detail: `${bytes.byteLength} bytes` };
      }
      return { ok: true, image: { bytes, contentType: "image/jpeg" } };
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
    },
    async sign(path) {
      return objects.has(path) ? `https://storage.test/${path}?sig=1` : null;
    },
  };
}

function deps(
  decision: "approved" | "needs_review" = "approved",
  storage = memoryStorage(),
): ReturnType<typeof memoryStorage> {
  __setMessagePhotoRouteDepsForTest({
    storage,
    moderation: () => ({ moderate: async () => ({ decision }) }),
  });
  // The serve route reads the SAME fake bucket, so the journey under test runs
  // upload and read over one store rather than a stubbed download.
  __setMessagePhotoServeRouteDepsForTest({
    downloadObject: async (key) => {
      const result = await storage.readBack(key);
      return result.ok ? result.image : null;
    },
  });
  return storage;
}

async function openConversation(): Promise<string> {
  asUser("user-ken");
  const res = await POST_INBOX(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "open", handle: "ken", other: "sam" }),
    }),
  );
  const body = (await res.json()) as { conversationId: string };
  return body.conversationId;
}

function postJson(id: string, body: unknown): Promise<Response> {
  return POST_THREAD(
    new Request(`${BASE}/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function postPhoto(id: string, file: File, post: Record<string, unknown>): Promise<Response> {
  const form = new FormData();
  form.set("post", JSON.stringify({ action: "send", ...post }));
  form.set("photo", file);
  return POST_THREAD(new Request(`${BASE}/${id}`, { method: "POST", body: form }), {
    params: Promise.resolve({ id }),
  });
}

function getThread(id: string, handle: string): Promise<Response> {
  return GET_THREAD(new Request(`${BASE}/${id}?handle=${handle}`), {
    params: Promise.resolve({ id }),
  });
}

function getPhoto(id: string, messageId: string, handle: string): Promise<Response> {
  return GET_PHOTO(new Request(`${BASE}/${id}/photo/${messageId}?handle=${handle}`), {
    params: Promise.resolve({ id, messageId }),
  });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  limitState.limited = false;
  venueState.found = true;
  venueState.kind = "pub";
  venueState.cheapestPrice = 5.4;
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetPintDrops();
  __setMessagePhotoRouteDepsForTest(null);
  __setMessagePhotoServeRouteDepsForTest(null);
  // A conversation is opened WITH somebody, so every handle here has to exist
  // and be owned by the account that signs in as it.
  for (const handle of ["ken", "sam", "mallory"]) {
    __seedMemoryOwnedProfile(handle, `user-${handle}`);
  }
});

describe("sending a photo", () => {
  it("takes a photo with no caption, keys it to the conversation, and strips EXIF", async () => {
    const id = await openConversation();
    const storage = deps();
    asUser("user-ken");

    const res = await postPhoto(id, await jpegWithFakeGps(), { handle: "ken", body: "" });
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as {
      message: { id: string; body: string; attachment: { kind: string; url: string } };
    };
    expect(message.body).toBe("");
    expect(message.attachment.kind).toBe("photo");
    expect(message.attachment.url).toBe(`/api/messages/${id}/photo/${message.id}`);

    // The serving key only, in this conversation's own folder, with staging gone.
    expect(storage.keys()).toEqual([messagePhotoServingKey(id, message.id)]);
    expect(storage.keys()).not.toContain(messagePhotoStagingKey(id, message.id));

    const stored = storage.objects.get(messagePhotoServingKey(id, message.id));
    expect(stored).toBeTruthy();
    expect(stored!.includes(Buffer.from("FAKE-GPS-LAT", "binary"))).toBe(false);
  });

  it("leaves nothing behind when the scan REFUSES, and says so", async () => {
    const id = await openConversation();
    const storage = deps("needs_review");
    asUser("user-ken");

    const res = await postPhoto(id, await jpeg(), { handle: "ken", body: "look at this" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("PHOTO_REFUSED");
    expect(storage.keys()).toEqual([]);

    const thread = await (await getThread(id, "ken")).json();
    expect(thread.messages).toEqual([]);
  });

  it("still sends when the scan could not RUN (the scan is advisory)", async () => {
    const id = await openConversation();
    const storage = deps();
    __setMessagePhotoRouteDepsForTest({
      storage,
      moderation: () => {
        throw new Error("no provider key");
      },
    });
    asUser("user-ken");

    const res = await postPhoto(id, await jpeg(), { handle: "ken", body: "" });
    expect(res.status).toBe(201);
    expect(storage.keys()).toHaveLength(1);
  });

  it("spends no scan on a conversation the sender is not in", async () => {
    const id = await openConversation();
    const storage = deps();
    let scans = 0;
    __setMessagePhotoRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => {
          scans += 1;
          return { decision: "approved" as const };
        },
      }),
    });
    asUser("user-mallory");

    const res = await postPhoto(id, await jpeg(), { handle: "mallory", body: "" });
    expect(res.status).toBe(404);
    expect(scans).toBe(0);
    expect(storage.keys()).toEqual([]);
  });
});

describe("reading a photo", () => {
  async function sendPhoto(id: string): Promise<{ messageId: string; storage: ReturnType<typeof memoryStorage> }> {
    const storage = deps();
    asUser("user-ken");
    const res = await postPhoto(id, await jpeg(), { handle: "ken", body: "" });
    const { message } = (await res.json()) as { message: { id: string } };
    return { messageId: message.id, storage };
  }

  it("serves the bytes to both participants and nobody else", async () => {
    const id = await openConversation();
    const { messageId } = await sendPhoto(id);

    asUser("user-ken");
    const mine = await getPhoto(id, messageId, "ken");
    expect(mine.status).toBe(200);
    expect(mine.headers.get("Content-Type")).toBe("image/jpeg");
    // A DM photo is one person's, so nothing shared may hold a copy.
    expect(mine.headers.get("Cache-Control")).toBe("private, no-store");

    asUser("user-sam");
    expect((await getPhoto(id, messageId, "sam")).status).toBe(200);

    asUser("user-mallory");
    const theirs = await getPhoto(id, messageId, "mallory");
    expect(theirs.status).toBe(404);
    expect((await theirs.json()).error).toBe("Photo not found.");

    authState.userId = null;
    expect((await getPhoto(id, messageId, "ken")).status).toBe(401);
  });

  it("stops serving a photo a reader reported, and drops it from the thread", async () => {
    const id = await openConversation();
    const { messageId } = await sendPhoto(id);

    asUser("user-sam");
    const flagged = await postJson(id, { action: "report", handle: "sam", messageId });
    expect(flagged.status).toBe(200);
    expect((await flagged.json()).flagged).toBe(true);

    expect((await getPhoto(id, messageId, "sam")).status).toBe(404);
    asUser("user-ken");
    // The sender loses it too: in a conversation of two, the person who
    // objected is the whole audience.
    expect((await getPhoto(id, messageId, "ken")).status).toBe(404);

    const thread = await (await getThread(id, "ken")).json();
    expect(thread.messages[0].attachment).toBeUndefined();
    expect(thread.messages[0].flagged).toBe(true);
  });
});

describe("sharing a pub", () => {
  it("stores an id and resolves the card on the read path", async () => {
    const id = await openConversation();
    asUser("user-ken");

    const res = await postJson(id, {
      action: "send",
      handle: "ken",
      body: "here tonight?",
      venueId: VENUE,
    });
    expect(res.status).toBe(201);

    const thread = await (await getThread(id, "ken")).json();
    expect(thread.messages[0].attachment).toEqual({
      kind: "venue",
      venueId: VENUE,
      card: {
        venueId: VENUE,
        name: "The Coach and Horses",
        area: "Soho",
        priceGbp: 5.4,
        mapUrl: `/map?sel=${VENUE}`,
      },
    });

    // Live, not frozen: the same stored row reads the new name afterwards.
    venueState.name = "The Coach & Horses";
    const again = await (await getThread(id, "ken")).json();
    expect(again.messages[0].attachment.card.name).toBe("The Coach & Horses");
  });

  it("prints no figure for a venue that is not a pub", async () => {
    const id = await openConversation();
    asUser("user-ken");
    venueState.kind = "bar";
    await postJson(id, { action: "send", handle: "ken", body: "", venueId: VENUE });

    const thread = await (await getThread(id, "ken")).json();
    expect(thread.messages[0].attachment.card.priceGbp).toBeNull();
  });

  it("says the card could not be read rather than inventing a pub", async () => {
    const id = await openConversation();
    asUser("user-ken");
    await postJson(id, { action: "send", handle: "ken", body: "", venueId: VENUE });
    venueState.found = false;

    const thread = await (await getThread(id, "ken")).json();
    expect(thread.messages[0].attachment).toEqual({
      kind: "venue",
      venueId: VENUE,
      card: null,
    });
  });

  it("refuses a venue id that is not one", async () => {
    const id = await openConversation();
    asUser("user-ken");
    const res = await postJson(id, {
      action: "send",
      handle: "ken",
      body: "",
      venueId: "../../etc/passwd",
    });
    expect(res.status).toBe(400);
  });
});

describe("a message still has to be something", () => {
  it("refuses a send with neither words nor an attachment", async () => {
    const id = await openConversation();
    asUser("user-ken");
    const res = await postJson(id, { action: "send", handle: "ken", body: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Write a message.");
  });
});
