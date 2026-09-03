import { describe, expect, it } from "vitest";

import {
  isModerationErrorRetryable,
  moderationJobShouldRetry,
  moderationRetryBackoffMs,
} from "@/lib/moderationRetry";

describe("moderation retry policy", () => {
  it("retries unknown failures unless an adapter marks the error terminal", () => {
    expect(isModerationErrorRetryable(new Error("provider unavailable"))).toBe(true);
    expect(isModerationErrorRetryable({ retryable: true })).toBe(true);
    expect(isModerationErrorRetryable({ retryable: false })).toBe(false);
  });

  it("caps exponential backoff at sixty minutes", () => {
    expect(moderationRetryBackoffMs(1)).toBe(60_000);
    expect(moderationRetryBackoffMs(7)).toBe(3_600_000);
    expect(moderationRetryBackoffMs(8)).toBe(3_600_000);
  });

  it("stops after the eighth attempt or a terminal error", () => {
    expect(moderationJobShouldRetry(new Error("provider unavailable"), 7)).toBe(true);
    expect(moderationJobShouldRetry(new Error("provider unavailable"), 8)).toBe(false);
    expect(moderationJobShouldRetry({ retryable: false }, 1)).toBe(false);
  });
});
