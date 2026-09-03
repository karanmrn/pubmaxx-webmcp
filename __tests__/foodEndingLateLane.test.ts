import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { foodEndingSelection } from "@/components/night/NightModeCard";
import {
  LATE_FOOD_OPERATOR_MENU_LINK_LABEL,
  lateFoodHoursConfidenceLabel,
  lateFoodNearMapUrl,
  getLateFoodForArea,
} from "@/lib/lateFood";
import { MAP_EXPERIENCE_LENS_URL_PARAM, parseMapExperienceLensParam } from "@/lib/mapExperienceLens";

const ROOT = process.cwd();
const nightModeCardSource = readFileSync(
  join(ROOT, "components/night/NightModeCard.tsx"),
  "utf8",
);

const SNAPSHOT_NOW = Date.parse("2026-07-16T23:00:00.000Z");

describe("lateFoodNearMapUrl", () => {
  it("opens the map food view around the last stop", () => {
    const href = lateFoodNearMapUrl("venue-s2ppfm");
    expect(href).toBe(
      `/map?sel=venue-s2ppfm&${MAP_EXPERIENCE_LENS_URL_PARAM}=food`,
    );
    expect(href).not.toMatch(/just-eat|deliveroo/i);
  });
});

describe("food ending handoff", () => {
  it("builds food ending selections from late-food terminals", () => {
    const terminal = getLateFoodForArea("piccadilly-soho", [], {
      now: SNAPSHOT_NOW,
    })[0]!;
    const selection = foodEndingSelection(terminal);
    expect(selection.kind).toBe("food");
    expect(selection.optionId).toBe(terminal.id);
    expect(selection.externalPlaceId).toBe(terminal.id);
    expect(selection.evidenceSnapshot.source).toContain(terminal.provenance.source);
    expect(selection.evidenceSnapshot.warnings).toContain(terminal.hours.service);
  });

  it("labels operator menus honestly", () => {
    expect(LATE_FOOD_OPERATOR_MENU_LINK_LABEL).toBe("Opens operator menu");
    expect(lateFoodHoursConfidenceLabel("high")).toBe("Hours confidence: high");
    expect(nightModeCardSource).toContain("LATE_FOOD_OPERATOR_MENU_LINK_LABEL");
    expect(nightModeCardSource).toContain("See late food near the last stop");
    expect(nightModeCardSource).not.toContain("Official menu");
  });

  it("does not link to delivery platforms on the food ending surface", () => {
    expect(nightModeCardSource).not.toMatch(/just-eat|deliveroo|justeat/i);
    expect(nightModeCardSource).not.toMatch(/https?:\/\/[^"'\s]*(just-eat|deliveroo)/i);
  });
});

describe("food ending voice fence", () => {
  const foodSurface = nightModeCardSource.slice(
    nightModeCardSource.indexOf("function FoodEndingPicker"),
    nightModeCardSource.indexOf("function GetHomeEndingConfirmation"),
  );

  it("keeps jokes and exclamation marks off the food ending picker", () => {
    expect(foodSurface).not.toMatch(/!/);
    expect(foodSurface).not.toMatch(/\bGrab a late bite\b/i);
    expect(foodSurface).not.toMatch(/\byum\b|\btasty\b|\bcheeky\b/i);
  });

  it("states what the map link does without inventing hours or delivery", () => {
    expect(foodSurface).toContain("Opens the map on food places near your last pub");
    expect(foodSurface).not.toMatch(/\bdeliver\b|\bdelivery\b/i);
    expect(foodSurface).not.toContain("verify tonight");
  });
});

describe("parseMapExperienceLensParam", () => {
  it("accepts food and no-alcohol deep links", () => {
    expect(parseMapExperienceLensParam("food")).toBe("food");
    expect(parseMapExperienceLensParam("no-alcohol")).toBe("no-alcohol");
    expect(parseMapExperienceLensParam("pint")).toBeNull();
  });
});
