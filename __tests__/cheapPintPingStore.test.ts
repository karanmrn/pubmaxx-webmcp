import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { canPromptCheapPint } from "@/lib/cheapPintPing";

const ACTOR = "profile:22222222-2222-4222-8222-222222222222";
const TOKEN = "webpush:cheap-pint-store";

describe("cheap pint ping store", () => {
  beforeEach(() => {
    __resetStepOutNudgeStore();
  });

  it("qualifies once and prompts until opt-in or decline", async () => {
    const qualified = await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    expect(qualified.cheapPintQualified).toBe(true);
    expect(canPromptCheapPint({
      qualified: qualified.cheapPintQualified,
      enabled: qualified.cheapPintEnabled,
      declined: qualified.cheapPintDeclined,
      sentAt: qualified.cheapPintSentAt,
    })).toBe(true);

    const again = await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    expect(again.cheapPintQualified).toBe(true);
  });

  it("decline is durable and clears cheap pint without dropping Step Out token", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    const declined = await memoryStepOutNudgeStore.declineCheapPint(ACTOR);
    expect(declined.cheapPintDeclined).toBe(true);
    expect(declined.cheapPintEnabled).toBe(false);
    expect(declined.enabled).toBe(true);
    expect(declined.subscriptionToken).toBe(TOKEN);

    const requalify = await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    expect(requalify.cheapPintQualified).toBe(true);
    expect(requalify.cheapPintDeclined).toBe(true);
  });

  it("opt-in shares the web push token and lists send-ready rows", async () => {
    await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    const opted = await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);
    expect(opted.cheapPintEnabled).toBe(true);
    expect(opted.subscriptionToken).toBe(TOKEN);
    expect(await memoryStepOutNudgeStore.listCheapPintSendReady()).toHaveLength(1);
  });

  it("opt-in clears a prior durable decline so send-ready rows can dispatch", async () => {
    await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    await memoryStepOutNudgeStore.declineCheapPint(ACTOR);
    const opted = await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);
    expect(opted.cheapPintDeclined).toBe(false);
    expect(opted.cheapPintEnabled).toBe(true);
    expect(await memoryStepOutNudgeStore.listCheapPintSendReady()).toHaveLength(1);
  });
});
