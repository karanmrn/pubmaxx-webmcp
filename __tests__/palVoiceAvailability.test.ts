// Voice is an optional add-on, and a Pal that cannot speak has to SAY so.
//
// The failure this pins is a Start button that answers 503 on the tap: that
// reads as a broken feature, while one honest line plus the writing door reads
// as a feature nobody has switched on. See docs/PUB_PAL_SETUP.md.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PAL_VOICE_UNAVAILABLE_LINE,
  PalVoiceOffline,
  palVoiceAvailabilityFrom,
} from "@/components/pubpal/PubPalVoice";
import { palVoiceConfigured } from "@/lib/pubPalVoiceConfig.server";

describe("palVoiceAvailabilityFrom", () => {
  it("only an explicit yes counts as available", () => {
    expect(palVoiceAvailabilityFrom(true, { available: true })).toBe("available");
    expect(palVoiceAvailabilityFrom(true, { available: false })).toBe("unavailable");
    expect(palVoiceAvailabilityFrom(true, {})).toBe("unavailable");
    expect(palVoiceAvailabilityFrom(true, null)).toBe("unavailable");
    expect(palVoiceAvailabilityFrom(false, { available: true })).toBe("unavailable");
  });
});

describe("the voice-off card", () => {
  it("explains itself in house voice and offers the door that works", () => {
    const markup = renderToStaticMarkup(createElement(PalVoiceOffline));
    expect(markup).toContain(PAL_VOICE_UNAVAILABLE_LINE);
    expect(markup).toContain('href="/pal/chat"');
    expect(markup).toContain("Ask in writing");
  });

  it("names no plumbing and slams no door", () => {
    expect(PAL_VOICE_UNAVAILABLE_LINE).not.toMatch(/ElevenLabs|API|token|503|env/i);
    expect(PAL_VOICE_UNAVAILABLE_LINE).not.toContain("—");
    expect(PAL_VOICE_UNAVAILABLE_LINE).toMatch(/Ask me in writing/);
  });
});

describe("palVoiceConfigured", () => {
  beforeEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_PUB_PAL_AGENT_ID;
  });

  it("needs both halves of the grant", () => {
    expect(palVoiceConfigured()).toBe(false);
    process.env.ELEVENLABS_API_KEY = "key";
    expect(palVoiceConfigured()).toBe(false);
    process.env.ELEVENLABS_PUB_PAL_AGENT_ID = "agent";
    expect(palVoiceConfigured()).toBe(true);
  });
});
