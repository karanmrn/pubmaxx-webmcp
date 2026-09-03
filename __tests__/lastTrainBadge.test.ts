import { describe, it, expect } from "vitest";

import {
  lastTrainBadge,
  lastTrainComposeFields,
  type LastTrainBadge,
} from "@/lib/lastTrainBadge";
import type { LastPintDecisionKind } from "@/lib/tfl";

// Pure badge logic for IDEAS A5 / PRD story 36. No network, no clock — every
// input is passed in. The honesty invariant under test: we ONLY claim what the
// timestamps prove ("before"/"after the last train"), NEVER "made the last
// train", and we return null whenever we can't back a claim with live data.

// A leave-by clock to anchor the relative-time cases around.
const LEAVE_BY = "2026-07-07T23:30:00.000Z";

const LIVE_KINDS: LastPintDecisionKind[] = [
  "order_one_more",
  "half_pint_only",
  "settle_up_now",
  "train_risk",
];

describe("lastTrainBadge — honest happy path", () => {
  it("stamps 'before the last train' (safe) when posted before leave-by", () => {
    const badge = lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, "order_one_more");
    expect(badge).toEqual<LastTrainBadge>({ label: "before the last train", tone: "safe" });
  });

  it("stamps 'after the last train' (risk) when posted after leave-by", () => {
    const badge = lastTrainBadge("2026-07-07T23:45:00.000Z", LEAVE_BY, "train_risk");
    expect(badge).toEqual<LastTrainBadge>({ label: "after the last train", tone: "risk" });
  });

  it("treats posting exactly at leave-by as still 'before' (inclusive, safe)", () => {
    const badge = lastTrainBadge(LEAVE_BY, LEAVE_BY, "settle_up_now");
    expect(badge).toEqual<LastTrainBadge>({ label: "before the last train", tone: "safe" });
  });

  it("never emits a 'made the last train' claim in any live case", () => {
    for (const kind of LIVE_KINDS) {
      const before = lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, kind);
      const after = lastTrainBadge("2026-07-07T23:59:00.000Z", LEAVE_BY, kind);
      for (const b of [before, after]) {
        expect(b).not.toBeNull();
        expect(b!.label.toLowerCase()).not.toContain("made");
      }
    }
  });

  it("produces a badge for every genuinely-live decision kind", () => {
    for (const kind of LIVE_KINDS) {
      expect(lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, kind)).not.toBeNull();
    }
  });
});

describe("lastTrainBadge — refuses to guess (null cases)", () => {
  it("returns null when TfL was unreachable (live_data_unavailable)", () => {
    expect(
      lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, "live_data_unavailable"),
    ).toBeNull();
  });

  it("returns null when there was no active decision", () => {
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, null)).toBeNull();
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", LEAVE_BY, undefined)).toBeNull();
  });

  it("returns null when there is no leave-by time", () => {
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", null, "order_one_more")).toBeNull();
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", undefined, "order_one_more")).toBeNull();
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", "", "order_one_more")).toBeNull();
  });

  it("returns null when there is no drop-created timestamp", () => {
    expect(lastTrainBadge(null, LEAVE_BY, "order_one_more")).toBeNull();
    expect(lastTrainBadge(undefined, LEAVE_BY, "order_one_more")).toBeNull();
    expect(lastTrainBadge("", LEAVE_BY, "order_one_more")).toBeNull();
  });

  it("returns null on unparseable ISO strings rather than throwing", () => {
    expect(lastTrainBadge("not-a-date", LEAVE_BY, "order_one_more")).toBeNull();
    expect(lastTrainBadge("2026-07-07T23:00:00.000Z", "garbage", "order_one_more")).toBeNull();
  });

  it("rejects an unknown decision kind (defensive against off-allowlist values)", () => {
    expect(
      lastTrainBadge(
        "2026-07-07T23:00:00.000Z",
        LEAVE_BY,
        "totally_made_up" as unknown as LastPintDecisionKind,
      ),
    ).toBeNull();
  });
});

describe("lastTrainComposeFields — Spill create payload (Wave G1)", () => {
  it("includes leaveByIso + lastTrainDecision when the decision is live", () => {
    for (const kind of LIVE_KINDS) {
      expect(
        lastTrainComposeFields({ decision: kind, leaveByIso: LEAVE_BY }),
      ).toEqual({ leaveByIso: LEAVE_BY, lastTrainDecision: kind });
    }
  });

  it("omits fields when TfL was unreachable (live_data_unavailable)", () => {
    expect(
      lastTrainComposeFields({
        decision: "live_data_unavailable",
        leaveByIso: LEAVE_BY,
      }),
    ).toBeNull();
  });

  it("omits fields when leaveByIso is missing or unparseable", () => {
    expect(
      lastTrainComposeFields({ decision: "order_one_more", leaveByIso: null }),
    ).toBeNull();
    expect(
      lastTrainComposeFields({ decision: "order_one_more", leaveByIso: "" }),
    ).toBeNull();
    expect(
      lastTrainComposeFields({ decision: "train_risk", leaveByIso: "not-a-date" }),
    ).toBeNull();
  });

  it("omits fields when there is no active decision", () => {
    expect(lastTrainComposeFields(null)).toBeNull();
    expect(lastTrainComposeFields(undefined)).toBeNull();
  });
});

describe("lastTrainBadge — timezone safety (instants, not wall clocks)", () => {
  it("compares absolute instants: same moment in different offsets is 'before'", () => {
    // 23:00Z == 00:00+01:00 next local hour; both are the SAME instant, which is
    // before the 23:30Z leave-by, so the offset must not flip the verdict.
    const badge = lastTrainBadge("2026-07-08T00:00:00.000+01:00", LEAVE_BY, "half_pint_only");
    expect(badge).toEqual<LastTrainBadge>({ label: "before the last train", tone: "safe" });
  });

  it("a leave-by expressed in a non-UTC offset still ranks correctly", () => {
    // leaveBy 23:30Z, expressed as 22:30-01:00 == same instant. Posted 23:45Z is
    // after it → risk. Confirms both sides are normalised to epoch millis.
    const badge = lastTrainBadge(
      "2026-07-07T23:45:00.000Z",
      "2026-07-07T22:30:00.000-01:00",
      "settle_up_now",
    );
    expect(badge).toEqual<LastTrainBadge>({ label: "after the last train", tone: "risk" });
  });

  it("one minute past leave-by is 'after'; one minute before is 'before'", () => {
    expect(lastTrainBadge("2026-07-07T23:31:00.000Z", LEAVE_BY, "train_risk")).toEqual({
      label: "after the last train",
      tone: "risk",
    });
    expect(lastTrainBadge("2026-07-07T23:29:00.000Z", LEAVE_BY, "train_risk")).toEqual({
      label: "before the last train",
      tone: "safe",
    });
  });
});
