// The WHOLE journey for one owned image, end to end over one fake bucket:
// prepare (real sharp) -> stage -> promote -> serve. The two halves live in
// different lambdas in production and never meet in a test that stubs
// `downloadObject`, so the thing this pins is the SEAM between them - the key
// promote writes, the key serve asks for, and the bytes that survive the round
// trip through a Blob.
//
// A prod avatar uploaded 200 and then served 404 on every read with the DB row
// and the storage object both correct, which is only diagnosable if the seam is
// exercised for real. `__tests__/avatarServeRoute.test.ts` covers the serve
// gates with a stubbed download; this one refuses to stub it.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const bucket = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  downloadError: null as { message: string } | null,
  /** Every body the adapter handed storage-js, in call order. */
  bodies: [] as unknown[],
  /** Mangle even a correctly wrapped write, to drive the write-side proof. */
  corruptWrites: false,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  // One fake bucket behind BOTH `supabaseProfileImageStorage` (the writer) and
  // `downloadProfileImageObject` (the reader), so neither half can quietly
  // disagree with the other about the bucket, the key, or the bytes.
  const from = (bucketId: string) => {
    const at = (path: string) => `${bucketId}/${path}`;
    return {
      // The runtime that broke prod, modelled rather than described.
      // `uploadOrUpdate` builds a multipart body for a Blob and ONLY for a
      // Blob; anything else is handed to `fetch` raw, and there the bytes were
      // string-decoded. So a non-Blob body mangles here exactly as it did on
      // Vercel - which is what makes every assertion below a real fence.
      async upload(path: string, body: unknown) {
        bucket.bodies.push(body);
        let bytes =
          body instanceof Blob
            ? Buffer.from(await body.arrayBuffer())
            : Buffer.from(Buffer.from(body as Uint8Array).toString("utf8"), "utf8");
        if (bucket.corruptWrites) bytes = Buffer.from(bytes.toString("utf8"), "utf8");
        bucket.objects.set(at(path), bytes);
        return { data: { path }, error: null };
      },
      async remove(paths: string[]) {
        for (const path of paths) bucket.objects.delete(at(path));
        return { data: [], error: null };
      },
      async createSignedUrl(path: string, ttl: number) {
        if (!bucket.objects.has(at(path))) {
          return { data: null, error: { message: "Object not found" } };
        }
        return { data: { signedUrl: `https://storage.test/${path}?ttl=${ttl}` }, error: null };
      },
      // supabase-js answers a Blob, not a Buffer: the serve path has to get
      // real bytes back out of one.
      async download(path: string) {
        if (bucket.downloadError) return { data: null, error: bucket.downloadError };
        const bytes = bucket.objects.get(at(path));
        if (!bytes) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([new Uint8Array(bytes)]), error: null };
      },
    };
  };
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ storage: { from } }),
  };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limitState.limited };
});

import { GET } from "@/app/api/avatar/[profileId]/[generation]/route";
import { __setAvatarServeRouteDepsForTest } from "@/lib/profileImageServeRouteDeps.server";
import { log } from "@/lib/log";
import {
  downloadProfileImageObject,
  prepareProfileImage,
  promoteStagedProfileImage,
  stagePreparedProfileImage,
  supabaseProfileImageStorage,
} from "@/lib/profileImageMedia.server";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";
import { STORAGE_BUCKET } from "@/lib/supabase";

const PROFILE_ID = "562db223-41d1-424b-8127-e9eaecb41c5f";
const GENERATION = "e3c3a014-5702-43ab-bc1c-8d6d827fd95b";

async function iphoneShapedPhoto(): Promise<File> {
  // Portrait, over the 512px box, so the resize and the re-encode both run.
  const bytes = await sharp({
    create: { width: 1200, height: 1600, channels: 3, background: "#7d2838" },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "face.jpg", { type: "image/jpeg" });
}

/** Everything the upload half writes, with no store in the way. */
async function uploadAvatar(): Promise<{ objectKey: string; bytes: Buffer }> {
  const prepared = await prepareProfileImage(await iphoneShapedPhoto(), "avatar");
  const staged = await stagePreparedProfileImage(
    "avatar",
    PROFILE_ID,
    prepared,
    supabaseProfileImageStorage,
    GENERATION,
  );
  const promoted = await promoteStagedProfileImage(staged, supabaseProfileImageStorage);
  return { objectKey: promoted.objectKey, bytes: promoted.bytes };
}

function approvedProfile(objectKey: string): ProfileRecord {
  return {
    id: PROFILE_ID,
    handle: "karan",
    userId: "user-karan",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    avatarObjectKey: objectKey,
    avatarGeneration: GENERATION,
    avatarModerationState: "approved",
  };
}

/**
 * Everything the logger emitted. `log` splits levels across two console
 * methods on purpose (errors survive stdout filtering), so a test that watched
 * one of them would miss the line it is asserting on.
 */
function captureLog(): () => string {
  const spies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  return () =>
    spies.flatMap((spy) => spy.mock.calls.map(([line]) => String(line))).join("\n");
}

/** The serve route with its REAL download, pointed at the same fake bucket. */
function serve(profile: ProfileRecord): Promise<Response> {
  __setAvatarServeRouteDepsForTest({ getProfileById: async () => profile });
  return GET(new Request(`http://localhost/api/avatar/${PROFILE_ID}/${GENERATION}`), {
    params: Promise.resolve({ profileId: PROFILE_ID, generation: GENERATION }),
  });
}

beforeEach(() => {
  limitState.limited = false;
  bucket.objects.clear();
  bucket.bodies.length = 0;
  bucket.downloadError = null;
  bucket.corruptWrites = false;
  __setAvatarServeRouteDepsForTest(null);
});

afterEach(() => {
  __setAvatarServeRouteDepsForTest(null);
  vi.restoreAllMocks();
});

describe("owned image: upload then serve, over one bucket", () => {
  it("promotes to the key the serve route asks for", async () => {
    const { objectKey } = await uploadAvatar();
    expect(objectKey).toBe(profileImageServingKey("avatar", PROFILE_ID, GENERATION));
    expect([...bucket.objects.keys()]).toEqual([`${STORAGE_BUCKET}/${objectKey}`]);
  });

  it("serves the promoted bytes back byte for byte", async () => {
    const { objectKey, bytes } = await uploadAvatar();

    const response = await serve(approvedProfile(objectKey));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const served = Buffer.from(await response.arrayBuffer());
    expect(served.equals(bytes)).toBe(true);
  });

  // sharp's own JPEG has to satisfy the magic-byte re-check on the way OUT, not
  // only on the way in. A stricter reader here 404s an image nobody can fix.
  it("passes the download magic-byte re-check on sharp's own output", async () => {
    const { objectKey } = await uploadAvatar();
    const downloaded = await downloadProfileImageObject(objectKey);
    expect(downloaded?.contentType).toBe("image/jpeg");
    expect(downloaded?.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

// The prod defect: `GET /api/avatar/...` 404'd with `magic_bytes_mismatch,
// "61942 bytes, leading ef bf bd ef"`. `ef bf bd` is the UTF-8 replacement
// character, so the STORED object was the JPEG decoded as text and re-encoded.
// The upload route checked real magic bytes on sharp's output immediately
// before handing it over, which put the mangling between our `.upload()` call
// and the bucket: storage-js passes a raw Buffer body straight to `fetch`, and
// only a Blob takes its multipart branch.
describe("bytes reach the bucket as bytes", () => {
  it("hands storage-js a Blob, not a Buffer", async () => {
    await uploadAvatar();

    expect(bucket.bodies.length).toBeGreaterThan(0);
    for (const body of bucket.bodies) {
      expect(body).toBeInstanceOf(Blob);
      expect(Buffer.isBuffer(body)).toBe(false);
    }
  });

  it("keeps the content type on the option, which the Blob branch sends", async () => {
    await uploadAvatar();
    for (const body of bucket.bodies) {
      expect((body as Blob).type).toBe("image/jpeg");
    }
  });

  // The exact prod bytes, reproduced: a runtime that string-decodes the body.
  it("round-trips a JPEG through the runtime that mangled a raw Buffer", async () => {
    const { objectKey, bytes } = await uploadAvatar();

    const stored = bucket.objects.get(`${STORAGE_BUCKET}/${objectKey}`);
    expect(stored?.equals(bytes)).toBe(true);
    expect(stored?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

// A mangled write answers 200, so nothing upstream noticed for days. Promotion
// now reads its own serving key back, and refuses an upload it could not serve
// while there is still a person on the other end of the request.
describe("promotion proves its own write", () => {
  it("refuses the upload when the stored object is not the JPEG we made", async () => {
    bucket.corruptWrites = true;
    const emitted = captureLog();

    await expect(uploadAvatar()).rejects.toMatchObject({ code: "PROCESSING_FAILED" });

    expect(emitted()).toContain("uploaded_image.write_corrupt");
    expect(emitted()).toContain("ef bf bd");
  });

  it("leaves no unservable object behind at the serving key", async () => {
    bucket.corruptWrites = true;
    captureLog();

    await expect(uploadAvatar()).rejects.toThrow();

    const objectKey = profileImageServingKey("avatar", PROFILE_ID, GENERATION);
    expect(bucket.objects.has(`${STORAGE_BUCKET}/${objectKey}`)).toBe(false);
  });

  // The bytes are fine; the reader is what is not well. Failing the upload here
  // would cost an owner their face over a momentary outage, the same reading
  // `uploadedImageScan.server.ts` gives a scanner it cannot reach.
  it("lets an upload through when the read-back itself could not run", async () => {
    bucket.downloadError = { message: "upstream connect error" };
    const emitted = captureLog();

    const { objectKey } = await uploadAvatar();

    expect(bucket.objects.has(`${STORAGE_BUCKET}/${objectKey}`)).toBe(true);
    expect(emitted()).toContain("uploaded_image.write_unproven");
    expect(emitted()).not.toContain("uploaded_image.write_corrupt");
  });

  it("stays silent on a write it proved", async () => {
    const emitted = captureLog();

    await uploadAvatar();

    expect(emitted()).not.toContain("uploaded_image.write_corrupt");
    expect(emitted()).not.toContain("uploaded_image.write_unproven");
  });
});

describe("a serve 404 says which gate refused", () => {
  it("names the storage error rather than swallowing it", async () => {
    const { objectKey } = await uploadAvatar();
    bucket.downloadError = { message: "Object not found" };
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await serve(approvedProfile(objectKey));

    expect(response.status).toBe(404);
    const emitted = lines.mock.calls.map(([line]) => String(line)).join("\n");
    expect(emitted).toContain("profile_image.serve_refused");
    expect(emitted).toContain("object_unreadable");
    expect(emitted).toContain("Object not found");
  });

  it("names a magic-byte mismatch on bytes that are not a JPEG", async () => {
    const objectKey = profileImageServingKey("avatar", PROFILE_ID, GENERATION);
    bucket.objects.set(`${STORAGE_BUCKET}/${objectKey}`, Buffer.from("<html>nope</html>"));
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await serve(approvedProfile(objectKey));

    expect(response.status).toBe(404);
    const emitted = lines.mock.calls.map(([line]) => String(line)).join("\n");
    expect(emitted).toContain("object_unreadable");
    expect(emitted).toContain("magic_bytes_mismatch");
  });

  // The nine gates all answer "Photo not found.", so each has to name itself:
  // "hidden", "replaced by a newer generation" and "storage would not answer"
  // are three different operator problems wearing one status code.
  it.each([
    ["moderation_not_approved", { avatarModerationState: "hidden" as const }],
    // An absent image is all THREE fields absent. Clearing the key alone leaves
    // a row that names a generation and a moderation state with nothing to
    // serve, which is `object_key_unexpected` - a different operator problem.
    [
      "image_absent",
      {
        avatarObjectKey: undefined,
        avatarGeneration: undefined,
        avatarModerationState: undefined,
      },
    ],
    ["profile_unclaimed", { userId: undefined }],
    ["generation_mismatch", { avatarGeneration: "44444444-4444-4444-8444-444444444444" }],
    ["object_key_unexpected", { avatarObjectKey: "avatars/somebody-else/image.jpg" }],
  ])("names the %s gate", async (reason, overrides) => {
    const { objectKey } = await uploadAvatar();
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await serve({ ...approvedProfile(objectKey), ...overrides });

    expect(response.status).toBe(404);
    const emitted = lines.mock.calls.map(([line]) => String(line)).join("\n");
    expect(emitted).toContain("profile_image.serve_refused");
    expect(emitted).toContain(reason);
  });

  it("carries the ids and the object key an operator needs to find the row", async () => {
    const objectKey = profileImageServingKey("avatar", PROFILE_ID, GENERATION);
    bucket.downloadError = { message: "Object not found" };
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    await serve(approvedProfile(objectKey));

    const emitted = lines.mock.calls.map(([line]) => String(line)).join("\n");
    expect(emitted).toContain(PROFILE_ID);
    expect(emitted).toContain(GENERATION);
    // The key is not a secret: the public serve path already encodes it, and
    // without it the download line names no object at all.
    expect(emitted).toContain(objectKey);
  });

  // The write half is shared, so the read half is too. Two byte-identical
  // copies of "what counts as unreadable" is how the avatar and the pub wall
  // drift, and the drift would be invisible: both answer the same 404.
  it("keeps ONE reader behind both surfaces", async () => {
    const sources = await Promise.all(
      ["lib/profileImageMedia.server.ts", "lib/venuePhotoMedia.server.ts"].map((file) =>
        readFile(resolve(process.cwd(), file), "utf8"),
      ),
    );
    for (const source of sources) {
      expect(source).toContain("downloadUploadedImageObject(objectKey)");
      expect(source).not.toMatch(/\.download\(/);
      expect(source).not.toMatch(/magicBytesOk\(bytes, "image\/jpeg"\)/);
    }
  });

  it("keeps the logger's own secret scrubbing", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    log("warn", "profile_image.serve_refused", {
      detail: "download failed: Bearer sbp_secret_value",
    });
    const emitted = lines.mock.calls.map(([line]) => String(line)).join("\n");
    expect(emitted).not.toContain("sbp_secret_value");
  });
});
