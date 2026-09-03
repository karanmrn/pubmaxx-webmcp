import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: vi.fn(),
}));
vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => false),
}));
vi.mock("@/lib/pushTokenStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pushTokenStore")>(
    "@/lib/pushTokenStore",
  );
  return {
    ...actual,
    pushTokenStore: () => actual.memoryPushTokenStore,
  };
});
vi.mock("@/lib/stepOutNudgeStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stepOutNudgeStore")>(
    "@/lib/stepOutNudgeStore",
  );
  return {
    ...actual,
    stepOutNudgeStore: () => actual.memoryStepOutNudgeStore,
  };
});

import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import {
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
} from "@/lib/pushTokenStore";
import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { DELETE, GET, POST } from "@/app/api/step-out-nudge/route";

const ACTOR = "profile:55555555-5555-4555-8555-555555555555";
const TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/step-out-route",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;

function authOk() {
  vi.mocked(resolveContributionIdentity).mockResolvedValue({
    ok: true,
    accountId: "user-step-out",
    actor: ACTOR,
    handle: "step_out",
  });
}

beforeEach(() => {
  __resetStepOutNudgeStore();
  __resetMemoryPushTokens();
  authOk();
});

describe("GET/POST/DELETE /api/step-out-nudge", () => {
  it("returns default-off for a signed-in owner", async () => {
    const response = await GET(new Request("http://localhost/api/step-out-nudge"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      maxPerWeek: 1,
    });
  });

  it("enables with a web subscription and withdraws cleanly", async () => {
    const enable = await POST(
      new Request("http://localhost/api/step-out-nudge", {
        method: "POST",
        body: JSON.stringify({ enabled: true, token: TOKEN }),
      }),
    );
    expect(enable.status).toBe(200);
    await expect(enable.json()).resolves.toMatchObject({ enabled: true });
    expect(__listMemoryPushTokens().some((row) => row.token === TOKEN)).toBe(true);

    const withdraw = await DELETE(
      new Request("http://localhost/api/step-out-nudge", { method: "DELETE" }),
    );
    expect(withdraw.status).toBe(200);
    await expect(withdraw.json()).resolves.toMatchObject({ enabled: false });
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: false,
      subscriptionToken: null,
    });
    expect(__listMemoryPushTokens().some((row) => row.token === TOKEN)).toBe(false);
  });

  it("keeps the push token when cheap pint ping stays enabled", async () => {
    const enable = await POST(
      new Request("http://localhost/api/step-out-nudge", {
        method: "POST",
        body: JSON.stringify({ enabled: true, token: TOKEN }),
      }),
    );
    expect(enable.status).toBe(200);
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);

    const withdraw = await DELETE(
      new Request("http://localhost/api/step-out-nudge", { method: "DELETE" }),
    );
    expect(withdraw.status).toBe(200);
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: false,
      cheapPintEnabled: true,
      subscriptionToken: TOKEN,
    });
    expect(__listMemoryPushTokens().some((row) => row.token === TOKEN)).toBe(true);
  });

  it("refuses enable without a valid web token", async () => {
    const response = await POST(
      new Request("http://localhost/api/step-out-nudge", {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
