import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  shouldResolveInitialNearPatch,
} from "@/components/nearme/NearMeNow";
import {
  nearAnswerReadyProps,
  nearVenueOpenedProps,
} from "@/lib/nearAnalytics";
import { sanitizeEvent } from "@/lib/analyticsEvents";

const nearSource = readFileSync(
  resolve(process.cwd(), "components/nearme/NearMeNow.tsx"),
  "utf8",
);

describe("near answer analytics", () => {
  it("uses coarse result and position bands", () => {
    expect(nearAnswerReadyProps("default-area", 0)).toEqual({
      source: "default-area",
      resultBand: "0",
    });
    expect(nearAnswerReadyProps("picked-area", 3).resultBand).toBe("1-3");
    expect(nearAnswerReadyProps("location", 5).resultBand).toBe("4+");
    expect(nearVenueOpenedProps("remembered-area", 1).positionBand).toBe("1");
    expect(nearVenueOpenedProps("picked-area", 3).positionBand).toBe("2-3");
    expect(nearVenueOpenedProps("location", 5).positionBand).toBe("4+");
  });

  it("keeps answer and open events free of venue identity and location", () => {
    expect(sanitizeEvent("near_answer_ready", {
      ...nearAnswerReadyProps("picked-area", 5),
      venueId: "venue-private",
      latitude: 51.5,
      patch: "soho",
    })).toEqual({
      name: "near_answer_ready",
      props: { source: "picked-area", resultBand: "4+" },
    });
    expect(sanitizeEvent("near_venue_opened", {
      ...nearVenueOpenedProps("default-area", 2),
      venueName: "Private pub",
      price: 4.5,
      coordinates: "51.5,-0.1",
    })).toEqual({
      name: "near_venue_opened",
      props: { source: "default-area", positionBand: "2-3" },
    });
  });

  it("rejects incomplete or invented source values", () => {
    expect(sanitizeEvent("near_answer_ready", { source: "exact-postcode", resultBand: "4+" }))
      .toBeNull();
    expect(sanitizeEvent("near_venue_opened", { source: "location" })).toBeNull();
  });

  it("tracks only the latest completed answer and opens before navigation", () => {
    expect(nearSource).toContain("const generation = ++answerGenerationRef.current;");
    expect(nearSource).toContain("if (generation !== answerGenerationRef.current) return;");
    expect(nearSource).toContain('trackEvent(\n      "near_answer_ready"');
    expect(nearSource).toContain('trackEvent(\n            "near_venue_opened"');
  });

  it("does not resolve a self-authored patch URL as a second answer", () => {
    expect(shouldResolveInitialNearPatch("soho", null)).toBe(true);
    expect(shouldResolveInitialNearPatch("soho", "soho")).toBe(false);
    expect(shouldResolveInitialNearPatch("camden", "soho")).toBe(true);
    expect(shouldResolveInitialNearPatch(null, "soho")).toBe(false);
  });
});
