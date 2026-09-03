import { describe, expect, it } from "vitest";

import { EXPECTED_RESERVED_CONTRIBUTOR_HANDLES } from "@/__tests__/fixtures/reservedContributorHandles";
import {
  assessPubmaxxHandle,
  evaluateHandleRename,
  HANDLE_RENAME_COOLDOWN_MS,
  RESERVED_CONTRIBUTOR_HANDLES,
} from "@/lib/pubmaxxIdentity";

describe("PUBMAXX handle policy", () => {
  it("accepts a canonical case-insensitive handle", () => {
    expect(assessPubmaxxHandle("  @Night_Owl  ")).toEqual({
      ok: true,
      handle: "night_owl",
    });
  });

  it("rejects malformed, short, reserved, and impersonating handles", () => {
    expect(assessPubmaxxHandle("ab")).toMatchObject({ ok: false, reason: "invalid" });
    expect(assessPubmaxxHandle("night-owl")).toMatchObject({ ok: false, reason: "invalid" });
    expect(assessPubmaxxHandle("PUBMAXX")).toMatchObject({ ok: false, reason: "reserved" });
    expect(assessPubmaxxHandle("pubmaxx_support")).toMatchObject({ ok: false, reason: "reserved" });
    for (const handle of RESERVED_CONTRIBUTOR_HANDLES) {
      expect(assessPubmaxxHandle(handle)).toMatchObject({
        ok: false,
        reason: "reserved",
      });
    }
  });

  it("reserves the exact contributor list and every entry is a valid handle shape", () => {
    expect(RESERVED_CONTRIBUTOR_HANDLES).toEqual(
      EXPECTED_RESERVED_CONTRIBUTOR_HANDLES,
    );
    for (const handle of EXPECTED_RESERVED_CONTRIBUTOR_HANDLES) {
      expect(handle).toMatch(/^[a-z0-9_]{3,30}$/);
      for (const compound of [
        `${handle}x`,
        `x${handle}`,
        `${handle}_pub`,
        `pub_${handle}`,
      ]) {
        expect(assessPubmaxxHandle(compound)).toEqual({
          ok: true,
          handle: compound,
        });
      }
    }
  });

  it.each(["Nikhil", " tiffany ", "TIFFANY"])(
    "normalizes and refuses contributor handle variant %j",
    (handle) => {
      expect(assessPubmaxxHandle(handle)).toEqual({
        ok: false,
        reason: "reserved",
        error: "That handle is not available.",
      });
    },
  );

  it("enforces a thirty-day rename cooldown and reports the exact retry time", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    const changedAt = new Date(now - HANDLE_RENAME_COOLDOWN_MS + 1_000).toISOString();

    expect(evaluateHandleRename({ changedAt, now })).toEqual({
      allowed: false,
      retryAt: new Date(now + 1_000).toISOString(),
    });
    expect(
      evaluateHandleRename({
        changedAt: new Date(now - HANDLE_RENAME_COOLDOWN_MS).toISOString(),
        now,
      }),
    ).toEqual({ allowed: true });
  });
});
