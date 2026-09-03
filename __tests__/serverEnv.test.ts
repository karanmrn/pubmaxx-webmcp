import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionSecrets,
  assertServerEnv,
  DEV_RATE_LIMIT_SALT,
} from "@/lib/serverEnv";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";
import { getSupabaseAdmin, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

describe("resolveSupabaseConfig", () => {
  it("trims and accepts HTTP(S) URLs with a non-blank key", () => {
    expect(resolveSupabaseConfig(" https://example.supabase.co/ ", " publishable-key ")).toEqual({
      url: "https://example.supabase.co/",
      key: "publishable-key",
    });
  });

  it.each(["not-a-valid-url", "ftp://example.supabase.co", "https:example.supabase.co"]) (
    "rejects %s as a Supabase URL",
    (url) => {
      expect(resolveSupabaseConfig(url, "service-role-key")).toBeNull();
    },
  );

  it("allows local HTTP only when HTTPS is not required", () => {
    expect(resolveSupabaseConfig("http://127.0.0.1:54321", "service-role-key")).toEqual({
      url: "http://127.0.0.1:54321",
      key: "service-role-key",
    });
    expect(
      resolveSupabaseConfig("http://127.0.0.1:54321", "service-role-key", {
        requireHttps: true,
      }),
    ).toBeNull();
  });

  it("keeps current and legacy public keys out of the server role", () => {
    expect(
      resolveSupabaseConfig("https://example.supabase.co", "sb_publishable_browser", {
        expectedKeyRole: "secret",
      }),
    ).toBeNull();
    expect(
      resolveSupabaseConfig(
        "https://example.supabase.co",
        "e30.eyJyb2xlIjoiYW5vbiJ9.signature",
        { expectedKeyRole: "secret" },
      ),
    ).toBeNull();
  });

  it("accepts current and legacy keys only in their matching role", () => {
    expect(
      resolveSupabaseConfig("https://example.supabase.co", "sb_publishable_browser", {
        expectedKeyRole: "publishable",
      }),
    ).not.toBeNull();
    expect(
      resolveSupabaseConfig("https://example.supabase.co", "sb_secret_server", {
        expectedKeyRole: "secret",
      }),
    ).not.toBeNull();
    expect(
      resolveSupabaseConfig(
        "https://example.supabase.co",
        "e30.eyJyb2xlIjoiYW5vbiJ9.signature",
        { expectedKeyRole: "publishable" },
      ),
    ).not.toBeNull();
    expect(
      resolveSupabaseConfig(
        "https://example.supabase.co",
        "e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
        { expectedKeyRole: "secret" },
      ),
    ).not.toBeNull();
  });
});

describe("isSupabaseConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a malformed server URL even when the service key is present", () => {
    vi.stubEnv("SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

    expect(isSupabaseConfigured()).toBe(false);
  });

  it("returns no admin client for a malformed server URL", () => {
    vi.stubEnv("SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

    expect(() => getSupabaseAdmin()).not.toThrow();
    expect(getSupabaseAdmin()).toBeNull();
  });

  it("retries construction after malformed server configuration is repaired", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    const supabase = await import("@/lib/supabase");

    expect(supabase.getSupabaseAdmin()).toBeNull();

    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");

    expect(supabase.getSupabaseAdmin()).not.toBeNull();
  });

  it("rejects a cleartext service-role URL in deployed Production", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "http://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    const supabase = await import("@/lib/supabase");

    expect(supabase.isSupabaseConfigured()).toBe(false);
    expect(supabase.getSupabaseAdmin()).toBeNull();
  });

  it("allows local Supabase HTTP during local production-style runtime", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_local");
    const supabase = await import("@/lib/supabase");

    expect(supabase.isSupabaseConfigured()).toBe(true);
    expect(supabase.getSupabaseAdmin()).not.toBeNull();
  });

  it.each([
    ["current publishable key", "sb_publishable_browser"],
    ["legacy anon key", "e30.eyJyb2xlIjoiYW5vbiJ9.signature"],
    ["unknown key class", "opaque-production-key"],
  ])("rejects a %s from the server role", async (_label, key) => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
    const supabase = await import("@/lib/supabase");

    expect(supabase.isSupabaseConfigured()).toBe(false);
    expect(supabase.getSupabaseAdmin()).toBeNull();
  });
});

describe("assertProductionSecrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_TOKEN;
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PHASE;
    delete process.env.PUBMAX_E2E_KEYLESS;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "development");
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it.each([
    ["the Next production build phase", "phase-production-build", undefined],
    ["explicit keyless E2E mode", undefined, "1"],
  ])("skips secret checks during %s", (_label, nextPhase, e2eKeyless) => {
    vi.stubEnv("NODE_ENV", "production");
    if (nextPhase) process.env.NEXT_PHASE = nextPhase;
    if (e2eKeyless) process.env.PUBMAX_E2E_KEYLESS = e2eKeyless;

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("does not accept a truthy-looking value for keyless E2E mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "true";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("ignores keyless E2E mode on a Vercel Production deploy", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "1";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
    expect(requiresSupabaseStore()).toBe(true);
  });

  it("is a no-op on Vercel Preview even when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    delete process.env.ADMIN_TOKEN;
    expect(() => assertProductionSecrets()).not.toThrow();
  });
  it("throws when ADMIN_TOKEN is unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("throws when ADMIN_TOKEN is blank in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "   ";
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("throws when RATE_LIMIT_SALT is unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    delete process.env.RATE_LIMIT_SALT;

    expect(() => assertProductionSecrets()).toThrow(/RATE_LIMIT_SALT/);
  });

  it("throws when RATE_LIMIT_SALT is still the dev default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = DEV_RATE_LIMIT_SALT;

    expect(() => assertProductionSecrets()).toThrow(/RATE_LIMIT_SALT/);
  });

  it("throws when RATE_LIMIT_SALT is too short for trusted production signing", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-but-short";

    expect(() => assertProductionSecrets()).toThrow(/shorter than 32 bytes/);
  });

  it("throws when the optional dedicated Plan signing secret is too short", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "random-rate-limit-salt-0123456789abcdef";
    process.env.PLAN_IDEMPOTENCY_SECRET = "too-short";

    expect(() => assertProductionSecrets()).toThrow(/PLAN_IDEMPOTENCY_SECRET/);
  });

  it("passes when production secrets are configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-production-salt-0123456789abcdef";

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("enforces secrets when VERCEL_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";
    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });
});

describe("assertServerEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_TOKEN;
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PHASE;
    delete process.env.PUBMAX_E2E_KEYLESS;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SUPABASE_URL;
    expect(() => assertServerEnv()).not.toThrow();
  });

  it.each([
    ["the Next production build phase", "phase-production-build", undefined],
    ["explicit keyless E2E mode", undefined, "1"],
  ])("allows keyless operation during %s", (_label, nextPhase, e2eKeyless) => {
    vi.stubEnv("NODE_ENV", "production");
    if (nextPhase) process.env.NEXT_PHASE = nextPhase;
    if (e2eKeyless) process.env.PUBMAX_E2E_KEYLESS = e2eKeyless;

    expect(() => assertServerEnv()).not.toThrow();
  });

  it("still rejects keyless production requests outside the build phase", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-server";

    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
  });

  it("is a no-op on Vercel Preview without Supabase", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertServerEnv()).not.toThrow();
  });
  it("throws when Supabase is missing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
  });

  it("throws when Supabase is configured but secrets are missing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertServerEnv()).toThrow(/ADMIN_TOKEN/);
  });

  it("passes when Supabase and production secrets are configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-production-salt-0123456789abcdef";

    expect(() => assertServerEnv()).not.toThrow();
  });
});

describe("requiresSupabaseStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.PUBMAX_E2E_KEYLESS;
  });

  it("keeps production-style Playwright keyless writes on the in-memory store", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "1";

    expect(requiresSupabaseStore()).toBe(false);
  });

  it("still requires durable storage for normal production runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.PUBMAX_E2E_KEYLESS;

    expect(requiresSupabaseStore()).toBe(true);
  });
});
