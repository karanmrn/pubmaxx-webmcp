import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the messaging routes. Pin the in-memory store at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — NOT a NODE_ENV stub
// (Vite bakes that at transform time). Same house pattern as notificationsRoute.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { GET as GET_INBOX, POST as POST_INBOX } from "@/app/api/messages/route";
import {
  GET as GET_THREAD,
  POST as POST_THREAD,
} from "@/app/api/messages/[id]/route";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
} from "@/lib/profileStore";

const BASE = "http://localhost/api/messages";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

/** Wave I2: DMs require a signed-in actor — set caller before each request. */
function asUser(userId: string): void {
  authState.userId = userId;
}

function getInbox(query?: string, headers?: HeadersInit): Promise<Response> {
  return GET_INBOX(new Request(query ? `${BASE}?${query}` : BASE, { headers }));
}
function postInbox(body: unknown, headers?: HeadersInit): Promise<Response> {
  return POST_INBOX(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
function getThread(id: string, query?: string): Promise<Response> {
  const url = query ? `${BASE}/${id}?${query}` : `${BASE}/${id}`;
  return GET_THREAD(new Request(url), { params: Promise.resolve({ id }) });
}
function postThread(id: string, body: unknown): Promise<Response> {
  return POST_THREAD(new Request(`${BASE}/${id}`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetPintDrops();
  // A conversation is opened WITH somebody, so every handle these cases talk to
  // has to exist and be owned by the account that signs in as it. An unknown
  // recipient has its own cases below.
  for (const handle of ["ken", "sam", "max", "mallory", "jen"]) {
    __seedMemoryOwnedProfile(handle, `user-${handle}`);
  }
});

describe("GET /api/messages — inbox", () => {
  it("returns an empty inbox for a missing handle (never 500)", async () => {
    const res = await getInbox();
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ conversations: [] });
  });

  it("401s when a handle is asserted without a signed-in actor (Wave I2)", async () => {
    const res = await getInbox("handle=ken");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/messages — open + send validation", () => {
  it("rejects a malformed body", async () => {
    asUser("user-ken");
    const res = await POST_INBOX(new Request(BASE, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("401s without a signed-in actor", async () => {
    expect((await postInbox({ action: "open", handle: "ken", other: "sam" })).status).toBe(401);
  });

  it("rejects a missing handle / recipient / self-message", async () => {
    // An account that owns no handle has none to fall back on. A LINKED account
    // resolves its own, which is the documented preference.
    asUser("user-nobody");
    expect((await postInbox({ action: "open", other: "sam" })).status).toBe(400);
    asUser("user-ken");
    expect((await postInbox({ action: "open", handle: "ken" })).status).toBe(400);
    expect((await postInbox({ action: "open", handle: "ken", other: "ken" })).status).toBe(400);
  });

  // `open` upserts a durable conversations row per distinct pair. It used to
  // take an unbounded number of them, against handles nobody holds, because the
  // limiter sat inside the `send` branch alone.
  it("refuses to open a conversation with a handle nobody holds", async () => {
    asUser("user-ken");
    const res = await postInbox({ action: "open", handle: "ken", other: "nobodyhere" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();

    const send = await postInbox({
      action: "send",
      handle: "ken",
      other: "nobodyhere",
      body: "hello?",
    });
    expect(send.status).toBe(404);
  });

  it("returns retryable 503 when recipient lookup is unavailable", async () => {
    asUser("user-ken");
    const original = memoryProfileStore.getByHandle.bind(memoryProfileStore);
    const spy = vi
      .spyOn(memoryProfileStore, "getByHandle")
      .mockImplementation((handle) =>
        handle === "sam" ? Promise.reject(new Error("store down")) : original(handle),
      );
    try {
      const res = await postInbox({ action: "open", handle: "ken", other: "sam" });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Profile storage is unavailable.",
        code: "UNAVAILABLE",
        retryable: true,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("rate-limits `open` the way it rate-limits `send`", async () => {
    asUser("user-ken");
    let limited: Response | null = null;
    for (let i = 0; i < 40; i += 1) {
      const res = await postInbox({ action: "open", handle: "ken", other: "sam" });
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect((await limited!.json()).code).toBe("RATE_LIMITED");
  });

  it("opens a conversation and returns a stable id", async () => {
    asUser("user-ken");
    const a = await (await postInbox({ action: "open", handle: "ken", other: "sam" })).json();
    asUser("user-sam");
    const b = await (await postInbox({ action: "open", handle: "@Sam", other: "KEN" })).json();
    expect(a.conversationId).toBeTruthy();
    expect(a.conversationId).toBe(b.conversationId);
  });

  it("send opens-if-needed, stores the message (201), and rejects a blank body", async () => {
    asUser("user-ken");
    const sent = await postInbox({ action: "send", handle: "ken", other: "sam", body: "hi sam" });
    expect(sent.status).toBe(201);
    expectNoStore(sent);
    const payload = await sent.json();
    expect(payload.message.body).toBe("hi sam");

    const blank = await postInbox({ action: "send", handle: "ken", other: "sam", body: "   " });
    expect(blank.status).toBe(400);
  });

  it("rejects an unknown action", async () => {
    asUser("user-ken");
    expect((await postInbox({ action: "poke", handle: "ken", other: "sam" })).status).toBe(400);
  });

  it("503s when the store fails to send after validation", async () => {
    asUser("user-ken");
    const { messagesStore } = await import("@/lib/messagesStore");
    const store = messagesStore();
    const openSpy = vi.spyOn(store, "openConversation").mockResolvedValue("conv-fail");
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue(null);
    try {
      const res = await postInbox({
        action: "send",
        handle: "ken",
        other: "sam",
        body: "should fail soft",
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Couldn't send that message.", code: "UNAVAILABLE", retryable: true });
    } finally {
      openSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });
});

describe("GET /api/messages/[id] — participant gating (the leak test)", () => {
  async function seed(): Promise<string> {
    asUser("user-ken");
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "secret" });
    return (await res.json()).conversationId;
  }

  it("serves the thread to a participant", async () => {
    const id = await seed();
    asUser("user-sam");
    const res = await getThread(id, "handle=sam");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(["secret"]);
  });

  it("returns 404 to a NON-participant — never leaks the thread", async () => {
    const id = await seed();
    asUser("user-mallory");
    const res = await getThread(id, "handle=mallory");
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).not.toHaveProperty("messages");
  });

  it("returns 404 for an unknown conversation and 401 without sign-in", async () => {
    asUser("user-ken");
    expect((await getThread("nope", "handle=ken")).status).toBe(404);
    authState.userId = null;
    expect((await getThread("nope")).status).toBe(401);
  });

  it("surfaces a 503 from the ownership gate instead of collapsing to 404", async () => {
    const id = await seed();
    asUser("user-ken");
    const spy = vi
      .spyOn(memoryProfileStore, "getByHandle")
      .mockRejectedValueOnce(new Error("store down"));
    const res = await getThread(id, "handle=ken");
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Profile storage is unavailable.", code: "UNAVAILABLE", retryable: true });
  });
});

describe("POST /api/messages/[id] — send + report gating", () => {
  async function seed(): Promise<string> {
    asUser("user-ken");
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "hi" });
    return (await res.json()).conversationId;
  }

  it("lets a participant reply (201) but 404s a non-participant sender", async () => {
    const id = await seed();
    asUser("user-sam");
    expect((await postThread(id, { action: "send", handle: "sam", body: "reply" })).status).toBe(
      201,
    );
    asUser("user-mallory");
    expect(
      (await postThread(id, { action: "send", handle: "mallory", body: "intrude" })).status,
    ).toBe(404);
  });

  it("lets a participant report a message; a non-participant gets 404", async () => {
    const id = await seed();
    asUser("user-sam");
    const thread = await (await getThread(id, "handle=sam")).json();
    const messageId = thread.messages[0].id;

    const ok = await postThread(id, { action: "report", handle: "sam", messageId });
    expect(ok.status).toBe(200);
    expectNoStore(ok);
    expect((await ok.json()).flagged).toBe(true);

    asUser("user-mallory");
    const leak = await postThread(id, { action: "report", handle: "mallory", messageId });
    expect(leak.status).toBe(404);
  });

  it("does not let a participant flag a message from another conversation", async () => {
    const firstId = await seed();
    asUser("user-jen");
    const second = await postInbox({
      action: "send",
      handle: "jen",
      other: "max",
      body: "private elsewhere",
    });
    const secondId = (await second.json()).conversationId;
    asUser("user-max");
    const secondThread = await (await getThread(secondId, "handle=max")).json();
    const foreignMessageId = secondThread.messages[0].id;

    asUser("user-sam");
    const res = await postThread(firstId, {
      action: "report",
      handle: "sam",
      messageId: foreignMessageId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flagged: false });

    asUser("user-max");
    const stillUnflagged = await (await getThread(secondId, "handle=max")).json();
    expect(stillUnflagged.messages[0].flagged).toBe(false);
  });
});

describe("messages auth ownership — linked handle wins over body handle", () => {
  it("sends as the auth-linked handle, ignoring a spoofed body handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    asUser("user-ken");

    const res = await postInbox({
      action: "send",
      handle: "mallory",
      other: "sam",
      body: "from ken",
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.message.senderHandle).toBe("ken");

    const inbox = await (await getInbox("handle=ignored")).json();
    expect(inbox.conversations.length).toBe(1);
  });

  it("401s when the linked owner is not signed in", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    const res = await postInbox({
      action: "send",
      handle: "ken",
      other: "sam",
      body: "spoof",
    });
    expect(res.status).toBe(401);
  });
});
