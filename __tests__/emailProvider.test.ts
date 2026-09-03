import { afterEach, describe, expect, it, vi } from "vitest";

// The email provider seam (lib/emailProvider.ts): env-based selection mirrors
// storeBackend.selectStore and pushProvider.selectPushProvider. No live Resend —
// selection is driven with vi.stubEnv, exactly like the push suite.
import {
  isResendConfigured,
  noopEmailProvider,
  resendEmailProvider,
  selectEmailProvider,
  type EmailMessage,
} from "@/lib/emailProvider";

const RESEND_ENV = {
  RESEND_API_KEY: "re_test_123",
  EMAIL_FROM: "hello@pubmaxxing.com",
};

function stubResendEnv(): void {
  for (const [k, v] of Object.entries(RESEND_ENV)) vi.stubEnv(k, v);
}

const MSG: EmailMessage = {
  to: "drinker@example.com",
  subject: "Your week in pints",
  html: "<p>hi</p>",
  text: "hi",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isResendConfigured", () => {
  it("is false unless both RESEND_API_KEY and EMAIL_FROM are present", () => {
    vi.stubEnv("RESEND_API_KEY", RESEND_ENV.RESEND_API_KEY);
    // Missing EMAIL_FROM.
    expect(isResendConfigured()).toBe(false);
  });

  it("is true when both keys are set", () => {
    stubResendEnv();
    expect(isResendConfigured()).toBe(true);
  });
});

describe("selectEmailProvider", () => {
  it("chooses the no-op provider when Resend is unconfigured", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(selectEmailProvider()).toBe(noopEmailProvider);
  });

  it("chooses the Resend provider once both env keys exist", () => {
    stubResendEnv();
    expect(selectEmailProvider()).toBe(resendEmailProvider);
  });
});

describe("noopEmailProvider", () => {
  it("reports every message as skipped, in input order, and never throws", async () => {
    const results = await noopEmailProvider.send([
      MSG,
      { ...MSG, to: "second@example.com" },
    ]);
    expect(results).toEqual([
      { to: "drinker@example.com", status: "skipped", reason: "email_provider_not_configured" },
      { to: "second@example.com", status: "skipped", reason: "email_provider_not_configured" },
    ]);
  });

  it("returns [] for no messages", async () => {
    expect(await noopEmailProvider.send([])).toEqual([]);
  });
});

describe("resendEmailProvider (stub)", () => {
  it("throws a not-configured error when env keys are missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    await expect(resendEmailProvider.send([MSG])).rejects.toThrow(
      /RESEND_API_KEY and EMAIL_FROM/,
    );
  });

  it("throws a not-implemented error when configured but transport is a pending drop-in", async () => {
    stubResendEnv();
    await expect(resendEmailProvider.send([MSG])).rejects.toThrow(/not implemented yet/);
  });
});
