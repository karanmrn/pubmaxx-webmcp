import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { CheapPintPingPayload } from "@/lib/cheapPintPing";
import {
  defaultCheapPintPingDispatchDeps,
  dispatchCheapPintPings,
  type CheapPintPingDispatchDeps,
} from "@/lib/cheapPintPingDispatch.server";
import { selectCheapPintPing } from "@/lib/cheapPintPingSelect.server";
import type { StepOutNudgePref } from "@/lib/stepOutNudgeStore";

vi.mock("@/lib/cheapPintPingSelect.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cheapPintPingSelect.server")>();
  return {
    ...actual,
    selectCheapPintPing: vi.fn(actual.selectCheapPintPing),
  };
});

const ACTOR = "profile:44444444-4444-4444-8444-444444444444";
const TOKEN = "webpush:cheap-pint-token";
const WED_5PM = new Date("2026-08-19T16:00:00.000Z");

function pref(partial: Partial<StepOutNudgePref> = {}): StepOutNudgePref {
  return {
    ownerActor: ACTOR,
    enabled: false,
    subscriptionToken: TOKEN,
    lastSentAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    cheapPintQualified: true,
    cheapPintEnabled: true,
    cheapPintDeclined: false,
    cheapPintSentAt: null,
    ...partial,
  };
}

describe("CheapPintPingDispatchDeps", () => {
  it("selectPayload is a single Promise, not Promise<Promise<...>>", () => {
    type SelectPayloadReturn = ReturnType<CheapPintPingDispatchDeps["selectPayload"]>;
    expectTypeOf<SelectPayloadReturn>().toEqualTypeOf<
      Promise<CheapPintPingPayload | null>
    >();
    expectTypeOf<SelectPayloadReturn>().not.toEqualTypeOf<
      Promise<Promise<CheapPintPingPayload | null>>
    >();
  });

  it("default selectPayload accepts now and forwards ownerActor and accountId", async () => {
    vi.mocked(selectCheapPintPing).mockResolvedValueOnce(null);
    const deps = defaultCheapPintPingDispatchDeps();
    const now = new Date("2026-08-19T16:00:00.000Z");
    await deps.selectPayload(ACTOR, "account-1", now);
    expect(selectCheapPintPing).toHaveBeenCalledWith(ACTOR, "account-1");
  });
});

describe("dispatchCheapPintPings", () => {
  it("skips outside the weekday 5pm window", async () => {
    const send = vi.fn();
    const deps: CheapPintPingDispatchDeps = {
      listSendReady: async () => [pref()],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => ({
        title: "Cheap pint nearby",
        body: "£4.50 at Example — about 5 min walk nearby.",
        url: "/map?sel=venue-1",
        venueId: "venue-1",
        priceLabel: "£4.50",
      }),
      send,
      markSent: vi.fn(),
    };
    const summary = await dispatchCheapPintPings(
      new Date("2026-08-22T16:00:00.000Z"),
      deps,
    );
    expect(summary.skippedWindow).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when no grounded pint is available", async () => {
    const send = vi.fn();
    const deps: CheapPintPingDispatchDeps = {
      listSendReady: async () => [pref()],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => null,
      send,
      markSent: vi.fn(),
    };
    const summary = await dispatchCheapPintPings(WED_5PM, deps);
    expect(summary.skippedNoGroundedPint).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once and stamps cheap_pint_sent_at", async () => {
    const markSent = vi.fn();
    const deps: CheapPintPingDispatchDeps = {
      listSendReady: async () => [pref()],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => ({
        title: "Cheap pint nearby",
        body: "£4.50 at Example — about 5 min walk nearby.",
        url: "/map?sel=venue-1",
        venueId: "venue-1",
        priceLabel: "£4.50",
      }),
      send: async () => ({ sent: 1, pruned: 0, errors: 0 }),
      markSent,
    };
    const summary = await dispatchCheapPintPings(WED_5PM, deps);
    expect(summary.sent).toBe(1);
    expect(markSent).toHaveBeenCalledWith(ACTOR, WED_5PM.toISOString());
  });
});
