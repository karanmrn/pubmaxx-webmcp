import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPersistentPlanMutationKey, persistentPlanMutationKey } from "@/lib/planMutationKey";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => vi.stubGlobal("sessionStorage", storage()));
afterEach(() => vi.unstubAllGlobals());

describe("persistent Plan mutation keys", () => {
  it("reuses one key for the same intent across retries and replaces it when intent changes", async () => {
    const first = await persistentPlanMutationKey("create", { title: "Friday", stops: ["a", "b"] });
    const retry = await persistentPlanMutationKey("create", { title: "Friday", stops: ["a", "b"] });
    const changed = await persistentPlanMutationKey("create", { title: "Saturday", stops: ["a", "b"] });
    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("clears only the matching completed operation", async () => {
    const key = await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null });
    clearPersistentPlanMutationKey("join:plan-1", "different-key");
    expect(await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null })).toBe(key);
    clearPersistentPlanMutationKey("join:plan-1", key);
    expect(await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null })).not.toBe(key);
  });
});
