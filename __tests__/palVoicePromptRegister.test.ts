import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  PAL_VOICE_GET_HOME_REGISTER_INTRO,
  PAL_VOICE_GET_HOME_REGISTER_RULES,
  PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
  buildPalVoiceOverrides,
  buildPalVoiceSystemPrompt,
} from "@/lib/palVoiceOverrides";

describe("Pub Pal voice prompt register", () => {
  const pal = {
    id: "pal-1",
    ownerId: "owner-1",
    name: "Ripley",
    adultAttestedAt: "2026-08-08T00:00:00.000Z",
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };

  it("pins the Safe Night register switch for get-home intents", () => {
    const prompt = buildPalVoiceSystemPrompt(pal);
    expect(prompt).toContain(PAL_VOICE_GET_HOME_REGISTER_INTRO);
    for (const rule of PAL_VOICE_GET_HOME_REGISTER_RULES) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toMatch(/one more drink/i);
    expect(prompt).toMatch(/Getting Home/i);
    expect(prompt).toMatch(/never assess whether the user is sober/i);
  });

  it("pins the propose-then-confirm sentence", () => {
    const prompt = buildPalVoiceSystemPrompt(pal);
    expect(prompt).toContain(PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE);
    expect(buildPalVoiceOverrides(pal).systemPrompt).toContain(PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE);
  });

  it("keeps get-home prompt strings free of jokes, em dashes, and exclamation marks", () => {
    const strings = [
      PAL_VOICE_GET_HOME_REGISTER_INTRO,
      ...PAL_VOICE_GET_HOME_REGISTER_RULES,
      PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
    ];
    for (const line of strings) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\blol\b/i);
      expect(line).not.toMatch(/\bha ha\b/i);
    }
  });
});
