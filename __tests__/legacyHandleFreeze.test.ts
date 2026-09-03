import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

import { callerUserId } from "@/lib/authServer";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  memoryProfileStore,
} from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  vi.mocked(callerUserId).mockReset();
  vi.mocked(callerUserId).mockResolvedValue("user-1");
});

describe("legacy handle freeze", () => {
  it("keeps an existing unlinked handle unavailable and unowned", async () => {
    const legacy = __seedMemoryLegacyProfile("old_timer");

    await expect(
      memoryIdentityHandleStore.availability("old_timer"),
    ).resolves.toEqual({
      handle: "old_timer",
      available: false,
      reason: "taken",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "old_timer"),
    ).resolves.toMatchObject({ ok: false, code: "taken" });
    const unchanged = await memoryProfileStore.getByHandle("old_timer");
    expect(unchanged?.id).toBe(legacy.id);
    expect(unchanged?.userId).toBeUndefined();
  });

  it("refuses first-touch linking of an existing unlinked handle", async () => {
    __seedMemoryLegacyProfile("old_timer");

    const gate = await gateHandleAction(
      new Request("http://localhost/api/messages", { method: "POST" }),
      "old_timer",
    );

    expect(gate).toEqual({
      allowed: false,
      status: 409,
      error: "That legacy handle is frozen. Choose a new handle for this account.",
    });
    expect((await memoryProfileStore.getByHandle("old_timer"))?.userId).toBeUndefined();
  });

  it("still creates a genuinely new handle and preserves linked owners", async () => {
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: true,
      handle: "fresh_person",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: true,
      handle: "fresh_person",
    });
    expect(await memoryProfileStore.getByHandle("fresh_person")).toMatchObject({
      userId: "user-1",
    });
  });

  it("keeps a post-migration generic ensure unavailable to canonical onboarding", async () => {
    const unowned = await memoryProfileStore.ensure("fresh_person");

    await expect(
      memoryIdentityHandleStore.availability("fresh_person"),
    ).resolves.toEqual({
      handle: "fresh_person",
      available: false,
      reason: "taken",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: false,
      code: "taken",
    });
    const unchanged = await memoryProfileStore.getByHandle("fresh_person");
    expect(unchanged?.id).toBe(unowned.id);
    expect(unchanged?.userId).toBeUndefined();
  });

  it("keeps a current owner idempotent after the alias cache is lost", async () => {
    const first = await memoryIdentityHandleStore.claim("user-1", "fresh_person");
    expect(first).toMatchObject({ ok: true, handle: "fresh_person" });

    __resetMemoryIdentityHandles();

    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toEqual(first);
  });

  it("reports the owned handle when two names race for one account", async () => {
    const results = await Promise.all([
      memoryIdentityHandleStore.claim("user-1", "racing_one"),
      memoryIdentityHandleStore.claim("user-1", "racing_two"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, code: "already_has_handle" }),
    ]);
  });
});
