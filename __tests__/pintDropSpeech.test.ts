import { describe, expect, it } from "vitest";

import { getSpeechRecognitionCtor } from "@/lib/pintDropSpeech";
import { VISIBILITY_COPY } from "@/lib/pintDropComposerConfig";
import { VISIBILITIES } from "@/lib/spill";

// Node env (no DOM): window is undefined, so the feature-detection guard should
// short-circuit to null rather than throwing.
describe("getSpeechRecognitionCtor", () => {
  it("returns null when window is undefined (server / node env)", () => {
    expect(typeof window).toBe("undefined");
    expect(getSpeechRecognitionCtor()).toBeNull();
  });
});

describe("VISIBILITY_COPY", () => {
  it("covers every visibility lane with a label + helper", () => {
    for (const v of VISIBILITIES) {
      expect(VISIBILITY_COPY[v]).toBeDefined();
      expect(VISIBILITY_COPY[v].label).toBeTruthy();
      expect(VISIBILITY_COPY[v].helper).toBeTruthy();
    }
  });
});
