import { describe, expect, it } from "vitest";

import { GROUP_PREF_MAX_ATMOSPHERE_CHIPS, overlapGroupPrefs, parseMatePreference, type MatePreference } from "@/lib/groupPrefs";

describe("group preferences", () => {
  it("fails soft with an empty crew", () => {
    expect(overlapGroupPrefs([])).toEqual({
      mateCount: 0,
      hardConstraints: {
        budgetBand: null,
        budgetLabel: null,
        zeroProofRequired: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
        sharedAtmosphereChips: [],
      },
      softScore: 0,
      scoreLabel: "No picks yet",
      summaryLabels: ["waiting on mate picks"],
      mustHaveLabels: [],
    });
  });

  it("turns one mate pick into a summary with hard constraints", () => {
    const overlap = overlapGroupPrefs([
      {
        mateId: "host",
        budgetBand: "standard",
        atmosphereChips: ["chatty"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
    ]);

    expect(overlap).toMatchObject({
      mateCount: 1,
      hardConstraints: {
        budgetBand: "standard",
        budgetLabel: "standard-price pints",
        zeroProofRequired: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
        sharedAtmosphereChips: ["chatty"],
      },
      softScore: 100,
      scoreLabel: "First pick saved",
      mustHaveLabels: ["Budget: standard-price pints"],
    });
    expect(overlap.summaryLabels).toEqual(["Budget: standard-price pints", "Shared vibe: Chatty tables"]);
  });

  it("promotes the strictest budget and any must-have asks to hard constraints", () => {
    const overlap = overlapGroupPrefs([
      {
        mateId: "host",
        budgetBand: "under6",
        atmosphereChips: ["cosy"],
        zeroProof: true,
        accessibilityRequired: true,
        weatherShelterRequired: false,
      },
      {
        mateId: "guest",
        budgetBand: "standard",
        atmosphereChips: ["cosy"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: true,
      },
    ]);

    expect(overlap.hardConstraints).toEqual({
      budgetBand: "under6",
      budgetLabel: "under GBP 6 pints",
      zeroProofRequired: true,
      accessibilityRequired: true,
      weatherShelterRequired: true,
      sharedAtmosphereChips: ["cosy"],
    });
    expect(overlap.softScore).toBe(81);
    expect(overlap.scoreLabel).toBe("Strong overlap");
    expect(overlap.mustHaveLabels).toEqual([
      "Budget: under GBP 6 pints",
      "Zero-proof options needed",
      "Step-free access needed",
      "Covered shelter needed",
    ]);
    expect(overlap.summaryLabels).toEqual([
      "Budget: under GBP 6 pints",
      "Zero-proof options needed",
      "Step-free access needed",
      "Covered shelter needed",
      "Shared vibe: Cosy corners",
    ]);
  });

  it("uses the leading atmosphere chip when the whole crew does not match", () => {
    const overlap = overlapGroupPrefs([
      {
        mateId: "a",
        budgetBand: "standard",
        atmosphereChips: ["cosy"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
      {
        mateId: "b",
        budgetBand: "standard",
        atmosphereChips: ["lively"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
      {
        mateId: "c",
        budgetBand: "standard",
        atmosphereChips: ["cosy"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
    ]);

    expect(overlap.hardConstraints.sharedAtmosphereChips).toEqual([]);
    expect(overlap.softScore).toBe(89);
    expect(overlap.summaryLabels).toEqual(["Budget: standard-price pints", "Top vibe: Cosy corners (2/3)"]);
  });

  it("keeps the newest valid preference per mate and clamps chips to the tap budget", () => {
    const parsed = parseMatePreference({
      mateId: "guest",
      budgetBand: "flexible",
      atmosphereChips: ["music", "food", "cosy"],
      zeroProof: true,
      accessibilityRequired: true,
      weatherShelterRequired: false,
      updatedAt: "2026-07-22T07:00:00.000Z",
    });
    expect(parsed?.atmosphereChips).toHaveLength(GROUP_PREF_MAX_ATMOSPHERE_CHIPS);
    expect(parsed?.atmosphereChips).toEqual(["music"]);
    expect(parsed?.accessibilityRequired).toBe(true);

    const overlap = overlapGroupPrefs([
      {
        mateId: "guest",
        budgetBand: "under6",
        atmosphereChips: ["cosy"],
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
        updatedAt: "2026-07-22T06:00:00.000Z",
      },
      parsed,
      { mateId: "", budgetBand: "standard", atmosphereChips: ["chatty"], zeroProof: false },
    ].filter(Boolean) as MatePreference[]);

    expect(overlap.mateCount).toBe(1);
    expect(overlap.hardConstraints.budgetBand).toBe("flexible");
    expect(overlap.hardConstraints.accessibilityRequired).toBe(true);
    expect(overlap.summaryLabels).toEqual([
      "Budget: flexible budget",
      "Zero-proof options needed",
      "Step-free access needed",
      "Shared vibe: Music-led",
    ]);
  });
});
