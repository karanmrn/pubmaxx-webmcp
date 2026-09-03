// The scan is ADVISORY, and this is the one place that says what that means.
//
// The whole point is the split: a VERDICT is honoured, and everything else -
// no key, a provider outage, an answer outside the contract, no signed URL to
// hand the scanner - is a fact about us rather than about the photo, so the
// upload proceeds and the skip is logged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileAvatarModerationError } from "@/lib/profileAvatarModeration";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";

const URL_ = "https://storage.test/avatars/p/g/staging.jpg?sig=1";

let warned: string[] = [];

beforeEach(() => {
  warned = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function skipLines(): Array<Record<string, unknown>> {
  return warned
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((record) => record.event === "uploaded_image.scan_skipped");
}

describe("a scan that reached a verdict", () => {
  it("approves what the adapter approved, and logs nothing", async () => {
    const result = await scanUploadedImage({
      surface: "profile-avatar",
      signedUrl: URL_,
      adapter: () => ({ moderate: async () => ({ decision: "approved" as const }) }),
    });
    expect(result).toEqual({ verdict: "approved" });
    expect(skipLines()).toEqual([]);
  });

  // The captain removed the availability blocker, not the negative verdicts.
  it("refuses what the adapter flagged", async () => {
    const result = await scanUploadedImage({
      surface: "venue-photo",
      signedUrl: URL_,
      adapter: () => ({ moderate: async () => ({ decision: "needs_review" as const }) }),
    });
    expect(result).toEqual({ verdict: "refused" });
    expect(skipLines()).toEqual([]);
  });
});

describe("a scan that reached no verdict", () => {
  it("skips when no provider is configured", async () => {
    const result = await scanUploadedImage({
      surface: "profile-avatar",
      signedUrl: URL_,
      adapter: () => {
        throw new ProfileAvatarModerationError("Profile avatar moderation is not configured.", false);
      },
    });
    expect(result).toEqual({ verdict: "skipped", reason: "adapter_unavailable" });
  });

  it("skips when the provider errors", async () => {
    const result = await scanUploadedImage({
      surface: "profile-cover",
      signedUrl: URL_,
      adapter: () => ({
        moderate: async () => {
          throw new ProfileAvatarModerationError("OpenRouter moderation returned 404.", false);
        },
      }),
    });
    expect(result).toEqual({ verdict: "skipped", reason: "scan_failed" });
  });

  it("skips when the staged bytes could not be signed", async () => {
    const result = await scanUploadedImage({
      surface: "venue-photo",
      signedUrl: null,
      adapter: () => {
        throw new Error("never reached");
      },
    });
    expect(result).toEqual({ verdict: "skipped", reason: "no_signed_url" });
  });

  // An adapter answering outside its own contract said nothing about the image,
  // so it is a skip. Reading it as a refusal would refuse on a provider bug.
  it("skips on an answer outside the adapter contract", async () => {
    const result = await scanUploadedImage({
      surface: "profile-avatar",
      signedUrl: URL_,
      adapter: () => ({
        moderate: async () => ({ decision: "maybe" as unknown as "approved" }),
      }),
    });
    expect(result).toEqual({ verdict: "skipped", reason: "no_decision" });
  });

  it("logs one line naming the surface and the reason", async () => {
    await scanUploadedImage({
      surface: "profile-cover",
      signedUrl: URL_,
      adapter: () => {
        throw new ProfileAvatarModerationError("OpenAI moderation is not configured.", false);
      },
    });
    const lines = skipLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      surface: "profile-cover",
      reason: "adapter_unavailable",
      detail: "OpenAI moderation is not configured.",
    });
  });
});
