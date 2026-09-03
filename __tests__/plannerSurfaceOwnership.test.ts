import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Taste gate 2026-08-02, finding M4 - two planners stacked in one sheet.
 *
 * The phone "Plan an outing" sheet and the desktop planner drawer render the same
 * `plannerPanel` tree. The desktop rail (ControlRail: brand block, mode toggle,
 * search box, featured routes, the whole filter stack) had no viewport guard, so
 * the phone sheet held the phone intake form, the built route, AND the entire
 * desktop panel below it. One sheet, two competing planners.
 *
 * One planner per surface. This reads the shipped source, because the defect is
 * a mount that only a phone-width viewport ever shows.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const pubMap = read("components/PubMap.tsx");

function plannerPanelSource(): string {
  const start = pubMap.indexOf("const plannerPanel = planningOpen ? (");
  expect(start, "the planner panel tree").toBeGreaterThan(-1);
  const end = pubMap.indexOf("\n  ) : null;", start);
  expect(end, "its closing branch").toBeGreaterThan(start);
  return pubMap.slice(start, end);
}

describe("finding M4 - one planner per surface", () => {
  it("keeps the desktop rail out of the phone sheet", () => {
    const panel = plannerPanelSource();
    // The rail mounts once, and only above the phone breakpoint.
    expect((panel.match(/<ControlRail\b/g) ?? []).length).toBe(1);
    expect(panel, "the rail waits for a desktop viewport").toMatch(
      /\{!mobileViewport \? \(\s*<ControlRail\b/,
    );
  });

  it("leaves the phone its own intake form", () => {
    const panel = plannerPanelSource();
    expect(panel).toMatch(/\{mobileViewport && isLondon && suggestedPlanArea \? \(\s*<MobilePlanActivation\b/);
  });

  it("still hands the desktop drawer the rail", () => {
    // The desktop drawer renders the same tree, so the guard above is the only
    // thing that decides. If the drawer ever stopped rendering plannerPanel, the
    // rail would have no home at all.
    expect(pubMap).toMatch(/side="left"[\s\S]{0,2000}\{plannerPanel\}/);
  });
});
