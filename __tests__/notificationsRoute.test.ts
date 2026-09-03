import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/notifications/route.ts. The route selects
// the in-memory notifications store, pinned deterministically at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — NOT via a NODE_ENV
// stub, which Vite bakes at transform time (a runtime stub is a silent no-op
// under a production build; backend selection reads SUPABASE_*, never NODE_ENV).
// See profileOwnershipRoute / pintDrops for the house pattern.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET, POST } from "@/app/api/notifications/route";
import { __resetMemoryNotifications, notificationsStore } from "@/lib/notificationsStore";

const URL_BASE = "http://localhost/api/notifications";
const originalSocialLaunch = process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function get(query?: string): Promise<Response> {
  return GET(new Request(query ? `${URL_BASE}?${query}` : URL_BASE));
}
function post(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryNotifications();
});

afterEach(() => {
  if (originalSocialLaunch === undefined) {
    delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  } else {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = originalSocialLaunch;
  }
});

describe("GET /api/notifications", () => {
  it("blocks Social notification reads and marks during emergency rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const read = await get("handle=ken");
    const mark = await post({ handle: "ken" });

    expect(read.status).toBe(503);
    expect(mark.status).toBe(503);
    expect(await read.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
    expect(await mark.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
  });

  it("returns an empty inbox for a missing handle (never 500)", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ notifications: [], unread: 0 });
  });

  it("returns a handle's notifications newest-first with an unread count", async () => {
    await notificationsStore().emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    await notificationsStore().emit({
      recipientHandle: "ken",
      actorHandle: "sam",
      kind: "comment",
      subjectRef: "d1",
    });
    const res = await get("handle=ken");
    expectNoStore(res);
    const body = (await res.json()) as { notifications: unknown[]; unread: number };
    expect(body.notifications).toHaveLength(2);
    expect(body.unread).toBe(2);
  });
});

describe("POST /api/notifications — mark read", () => {
  it("400s a body with no handle", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("marks all a handle's notifications read", async () => {
    await notificationsStore().emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    const res = await post({ handle: "ken" });
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = (await res.json()) as { unread: number };
    expect(body.unread).toBe(0);
  });

  it("400s a malformed JSON body", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });
});
