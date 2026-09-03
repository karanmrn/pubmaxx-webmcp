import { afterEach, describe, expect, it, vi } from "vitest";

import { assertCronRequest } from "@/lib/cronAuth";

// Hermetic: no network, no Vercel. We drive CRON_SECRET / NODE_ENV through
// vi.stubEnv and assert the gate's decisions directly.

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-weather", {
    headers: auth ? { authorization: auth } : {},
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertCronRequest", () => {
  it("allows a correct Bearer secret (returns null)", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    expect(assertCronRequest(req("Bearer s3cr3t"))).toBeNull();
  });

  it("401s a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    const res = assertCronRequest(req("Bearer nope"));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: "CRON_UNAUTHORIZED" });
  });

  it("401s a missing header when a secret is configured", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    expect(assertCronRequest(req())?.status).toBe(401);
  });

  it("401s (refuses) in production when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = assertCronRequest(req("Bearer anything"));
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: "CRON_NOT_CONFIGURED" });
  });

  it("allows in test/dev when CRON_SECRET is unset (local + suite need it)", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(assertCronRequest(req())).toBeNull();
  });
});
