import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { canSendStepOutNudge } from "@/lib/stepOutNudge";

const ACTOR = "profile:11111111-1111-4111-8111-111111111111";
const TOKEN = "webpush:e2e-sub";

describe("stepOutNudgeStore", () => {
  beforeEach(() => {
    __resetStepOutNudgeStore();
  });

  it("defaults to off and requires an explicit enable with a token", async () => {
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toBeNull();
    const enabled = await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.subscriptionToken).toBe(TOKEN);
    expect(enabled.lastSentAt).toBeNull();
    expect(canSendStepOutNudge(enabled.lastSentAt)).toBe(true);
  });

  it("withdraw clears the subscription and disables the pref", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    const withdrawn = await memoryStepOutNudgeStore.withdraw(ACTOR);
    expect(withdrawn.enabled).toBe(false);
    expect(withdrawn.subscriptionToken).toBeNull();
    expect(await memoryStepOutNudgeStore.listEnabled()).toEqual([]);
  });

  it("markSent stamps the per-subscription frequency gate", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    const sentAt = "2026-08-08T12:00:00.000Z";
    await memoryStepOutNudgeStore.markSent(ACTOR, sentAt);
    const pref = await memoryStepOutNudgeStore.get(ACTOR);
    expect(pref?.lastSentAt).toBe(sentAt);
    expect(canSendStepOutNudge(pref?.lastSentAt, Date.parse("2026-08-10T12:00:00.000Z"))).toBe(
      false,
    );
  });
});
