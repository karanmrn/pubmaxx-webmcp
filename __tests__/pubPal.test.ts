import { afterEach, describe, expect, it, vi } from "vitest";
import { palMascotSlug } from "@/lib/palMascotAssets.mjs";
import { cleanPalDraft, compatiblePalSpecies, DEFAULT_PAL_DRAFT, hasPalRouteActivation, markPalRouteActivation, migrateLegacyPalOnboardingDraft, PAL_ANIMATION_STATES, PAL_ONBOARDING_DRAFT_KEY, PAL_ONBOARDING_SPECIES, PAL_ROUTE_ACTIVATION_KEY, PAL_SPECIES, PAL_UNLOCKS, PAL_VISUAL_MANIFEST, palMasteryProgress, SIGNAL_FAMILIES, palOnboardingDraftKey, readPalOnboardingDraft, writePalOnboardingDraft } from "@/lib/pubPal";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("Pub Pal domain", () => {
  it("requires an adult attestation and a name", () => {
    expect(cleanPalDraft(DEFAULT_PAL_DRAFT)).toBeNull();
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).toMatchObject({ name: "Morrow", adultConfirmed: true });
  });

  it("rejects arbitrary species and voice identifiers", () => {
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow", appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "dragon" } })).toBeNull();
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow", voice: { ...DEFAULT_PAL_DRAFT.voice, id: "cloned-person" } })).toBeNull();
  });

  it("defines six Signal families and cosmetic-only unlock categories", () => {
    expect(SIGNAL_FAMILIES).toEqual(["beer", "gin", "rum", "whisky", "brandy", "vodka"]);
    expect(PAL_UNLOCKS.every(unlock => !["ranking", "alcohol", "drink_count"].includes(unlock.category))).toBe(true);
  });

  it("offers seven launch companions while retaining every legacy species", () => {
    expect(PAL_ONBOARDING_SPECIES).toEqual(["robin", "greyhound", "cat", "fox", "pigeon", "badger", "corgi"]);
    expect(PAL_SPECIES).toHaveLength(13);
    expect(new Set(PAL_SPECIES).size).toBe(13);
    expect(compatiblePalSpecies("black-cat")).toBe("cat");
    expect(compatiblePalSpecies("night_bot")).toBe("bot");
  });

  it("defaults new Pal drafts to the circuit robin", () => {
    expect(DEFAULT_PAL_DRAFT.appearance.species).toBe("robin");
  });

  it("ships seven reviewed launch visuals with every emotional state", () => {
    expect(Object.keys(PAL_VISUAL_MANIFEST)).toEqual(["robin", "greyhound", "cat", "fox", "pigeon", "badger", "corgi"]);
    expect(PAL_ANIMATION_STATES).toEqual(["idle", "noticing", "listening", "thinking", "speaking", "celebrating", "sleeping", "error"]);
    expect(Object.values(PAL_VISUAL_MANIFEST).every((visual) => (visual.format === "layered-svg" || visual.format === palMascotSlug(visual.species)) && visual.face && visual.signatureProp && visual.material && visual.idlePose && visual.supportedStates.length === 8)).toBe(true);
  });

  it("round-trips an incomplete five-step onboarding draft safely", () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: storage };
    writePalOnboardingDraft("user-1", {
      step: 2,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    expect(window.localStorage.getItem(palOnboardingDraftKey("user-1"))).toContain('"version":1');
    expect(readPalOnboardingDraft("user-1")).toMatchObject({ step: 2, draft: { name: "Nova" } });
    expect(readPalOnboardingDraft("user-2")).toBeNull();
    writePalOnboardingDraft("user-1", {
      step: 2,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("records route-first Pal eligibility without route or location context", () => {
    (globalThis as { window?: { localStorage: Storage; dispatchEvent: (event: Event) => boolean } }).window = { localStorage: memoryStorage(), dispatchEvent: () => true };
    expect(hasPalRouteActivation()).toBe(false);
    markPalRouteActivation();
    expect(hasPalRouteActivation()).toBe(true);
    const stored = window.localStorage.getItem(PAL_ROUTE_ACTIVATION_KEY) ?? "";
    expect(stored).toContain('"version":1');
    expect(stored).not.toMatch(/lat|lng|venue|planId|route/i);
  });

  it("migrates the old shared draft but requires a fresh adult attestation", () => {
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: memoryStorage() };
    window.localStorage.setItem(PAL_ONBOARDING_DRAFT_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date(0).toISOString(),
      step: 4,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: true, visible: true, muted: false },
    }));
    expect(migrateLegacyPalOnboardingDraft("user-1")).toMatchObject({ step: 0, draft: { name: "Nova", adultConfirmed: false }, privacy: { proposeMemories: false } });
    expect(window.localStorage.getItem(PAL_ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(readPalOnboardingDraft("user-1")).toMatchObject({ step: 0, draft: { adultConfirmed: false } });
  });
});

describe("palMasteryProgress", () => {
  it("measures the gap from the last item earned, not from zero", () => {
    const early = palMasteryProgress(0);
    expect(early.next?.id).toBe("signal-ring");
    expect(early.pointsToNext).toBe(40);
    expect(early.fraction).toBe(0);

    const midway = palMasteryProgress(65);
    expect(midway.next?.id).toBe("gin-glass");
    expect(midway.pointsToNext).toBe(25);
    expect(midway.fraction).toBeCloseTo(0.5, 5);
  });

  it("names the next item without saying anything is locked", () => {
    expect(palMasteryProgress(0).line).toBe("40 points to the Signal ring.");
    expect(palMasteryProgress(39).line).toBe("1 point to the Signal ring.");
    expect(palMasteryProgress(0).line).not.toMatch(/unlock/i);
  });

  it("stops promising a next item once every one is earned", () => {
    const done = palMasteryProgress(200);
    expect(done.next).toBeNull();
    expect(done.fraction).toBe(1);
    expect(done.line).toBe("Every mastery item earned.");
  });

  it("treats a nonsense point total as zero rather than throwing", () => {
    expect(palMasteryProgress(Number.NaN).pointsToNext).toBe(40);
    expect(palMasteryProgress(-10).pointsToNext).toBe(40);
  });
});
