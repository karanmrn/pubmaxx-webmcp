import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({ detached: 0, orphaned: 0 }));

vi.mock("@/lib/socialPostMedia.server", () => ({
  purgeDetachedSocialPhotos: async () => { state.detached += 1; return 3; },
  purgeOrphanedSocialPhotoUploads: async () => { state.orphaned += 1; return 2; },
}));

import { GET } from "@/app/api/cron/purge-social-media/route";

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  state.detached = 0;
  state.orphaned = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("Social photo cleanup worker", () => {
  it("reconciles detached rows and abandoned upload reservations independently", async () => {
    const denied = await GET(new Request("http://localhost/api/cron/purge-social-media"));
    expect(denied.status).toBe(401);
    const response = await GET(new Request("http://localhost/api/cron/purge-social-media", {
      headers: { Authorization: "Bearer cron-secret" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, detached: 3, orphaned: 2 });
    expect(state).toEqual({ detached: 1, orphaned: 1 });
  });

  it("skips cleanup during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const response = await GET(new Request("http://localhost/api/cron/purge-social-media", {
      headers: { Authorization: "Bearer cron-secret" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "social_rollback" });
    expect(state).toEqual({ detached: 0, orphaned: 0 });
  });

  it("has an independent production schedule", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path?: string }>;
    };
    expect(config.crons?.some((cron) => cron.path === "/api/cron/purge-social-media")).toBe(true);
  });
});
