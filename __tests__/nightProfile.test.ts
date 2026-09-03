import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanNightProfileInput,
  DEFAULT_NIGHT_PROFILE_INPUT,
  type NightProfile,
} from "@/lib/nightProfile";
import {
  confirmedNightProfileMerge,
  mirrorAccountNightProfileToDevice,
  nightProfileMergeState,
  readDeviceNightProfile,
  writeDeviceNightContext,
  writeDeviceNightProfile,
} from "@/lib/nightProfileClient";
import {
  __resetNightProfileStore,
  memoryNightProfileStore,
} from "@/lib/nightProfileStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("Night Profile contracts", () => {
  beforeEach(() => {
    __resetNightProfileStore();
    vi.useRealTimers();
  });

  it("rejects an invalid planning edit instead of corrupting the device profile", () => {
    const profile = cleanNightProfileInput(DEFAULT_NIGHT_PROFILE_INPUT);
    expect(profile).toEqual(DEFAULT_NIGHT_PROFILE_INPUT);
    expect(profile).not.toHaveProperty("companionName");
    expect(profile).not.toHaveProperty("species");
    expect(cleanNightProfileInput({
      ...DEFAULT_NIGHT_PROFILE_INPUT,
      context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, budgetLimitPence: 499 },
    })).toBeNull();
  });

  it("round-trips only validated versioned device preferences", () => {
    const storage = memoryStorage();
    expect(writeDeviceNightProfile(DEFAULT_NIGHT_PROFILE_INPUT, storage)).toBe(true);
    expect(readDeviceNightProfile(storage)).toEqual(DEFAULT_NIGHT_PROFILE_INPUT);
    storage.setItem("pubmaxx.night-profile.v1:device", JSON.stringify({ version: 2, profile: DEFAULT_NIGHT_PROFILE_INPUT }));
    expect(readDeviceNightProfile(storage)).toBeNull();
  });

  it("turns anonymous planning edits into a validated device profile only", () => {
    const storage = memoryStorage();
    const context = {
      ...DEFAULT_NIGHT_PROFILE_INPUT.context,
      nightArea: "piccadilly-soho" as const,
      budget: "value" as const,
      groupSize: 5,
      zeroProof: true,
      wetherspoonsPreferred: false,
    };
    const written = writeDeviceNightContext(context, "london", storage);

    expect(written).toMatchObject({ cityId: "london", context });
    const raw = storage.getItem("pubmaxx.night-profile.v1:device") ?? "";
    expect(raw).not.toContain("latitude");
    expect(raw).not.toContain("longitude");
    expect(raw).not.toContain("transcript");
    expect(readDeviceNightProfile(storage)).toEqual(written);
  });

  it("rejects an invalid planning edit instead of corrupting the device profile", () => {
    const storage = memoryStorage();
    writeDeviceNightProfile(DEFAULT_NIGHT_PROFILE_INPUT, storage);
    const invalid = {
      ...DEFAULT_NIGHT_PROFILE_INPUT.context,
      groupSize: 99,
    };

    expect(writeDeviceNightContext(invalid, "london", storage)).toBeNull();
    expect(readDeviceNightProfile(storage)).toEqual(DEFAULT_NIGHT_PROFILE_INPUT);
  });

  it("mirrors a loaded account profile onto the device for signed-out continuity", () => {
    const storage = memoryStorage();
    const account: NightProfile = {
      ...DEFAULT_NIGHT_PROFILE_INPUT,
      context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, budget: "treat" as const },
      createdAt: "2026-07-16T20:00:00.000Z",
      updatedAt: "2026-07-16T20:05:00.000Z",
    };

    const mirrored = mirrorAccountNightProfileToDevice(account, storage);
    expect(mirrored?.context.budget).toBe("treat");
    expect(readDeviceNightProfile(storage)?.context.budget).toBe("treat");
    expect(mirrorAccountNightProfileToDevice(null, storage)).toBeNull();
  });

  it("detects a merge but cannot choose a winner without an explicit choice", () => {
    const device = {
      ...DEFAULT_NIGHT_PROFILE_INPUT,
      context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, budget: "value" as const },
    };
    const account: NightProfile = {
      ...DEFAULT_NIGHT_PROFILE_INPUT,
      createdAt: "2026-07-16T20:00:00.000Z",
      updatedAt: "2026-07-16T20:05:00.000Z",
    };
    const state = nightProfileMergeState(device, account);
    expect(state.kind).toBe("conflict");
    if (state.kind !== "conflict") throw new Error("expected conflict");
    expect(confirmedNightProfileMerge(state, "bring-device")).toMatchObject({
      profile: device,
      expectedUpdatedAt: account.updatedAt,
      writesAccount: true,
    });
    expect(confirmedNightProfileMerge(state, "keep-account").writesAccount).toBe(false);
  });

  it("uses optimistic concurrency and keeps identical PUTs idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T20:00:00.000Z"));
    const created = await memoryNightProfileStore.put("owner-1", DEFAULT_NIGHT_PROFILE_INPUT, null);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected profile");

    const repeated = await memoryNightProfileStore.put(
      "owner-1",
      DEFAULT_NIGHT_PROFILE_INPUT,
      created.profile.updatedAt,
    );
    expect(repeated).toEqual(created);

    vi.setSystemTime(new Date("2026-07-16T20:01:00.000Z"));
    const updated = await memoryNightProfileStore.put(
      "owner-1",
      { ...DEFAULT_NIGHT_PROFILE_INPUT, voicePreference: "ptt" },
      created.profile.updatedAt,
    );
    expect(updated.ok).toBe(true);
    const stale = await memoryNightProfileStore.put(
      "owner-1",
      { ...DEFAULT_NIGHT_PROFILE_INPUT, voicePreference: "tts" },
      created.profile.updatedAt,
    );
    expect(stale).toMatchObject({ ok: false, error: "conflict" });
  });
});
