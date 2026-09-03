import { describe, expect, it } from "vitest";

import { createAuthSessionTransitionTracker } from "@/lib/authSessionTransition";

describe("auth session transition telemetry", () => {
  it("tracks only a SIGNED_IN transition from no session", () => {
    const tracker = createAuthSessionTransitionTracker();

    expect(tracker.update("INITIAL_SESSION", "user-a")).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
    expect(tracker.update("TOKEN_REFRESHED", "user-a")).toBe(false);
    expect(tracker.update("SIGNED_OUT", null)).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(true);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
  });

  it("seeds restored sessions without reporting a sign-in", () => {
    const tracker = createAuthSessionTransitionTracker();

    expect(tracker.update(null, "user-a")).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
  });

  it("exposes the latest auth owner synchronously with each transition", () => {
    const tracker = createAuthSessionTransitionTracker();

    tracker.update("SIGNED_IN", "user-a");
    expect(tracker.currentUserId()).toBe("user-a");

    tracker.update("SIGNED_IN", "user-b");
    expect(tracker.currentUserId()).toBe("user-b");

    tracker.update("SIGNED_OUT", null);
    expect(tracker.currentUserId()).toBeNull();
  });
});
