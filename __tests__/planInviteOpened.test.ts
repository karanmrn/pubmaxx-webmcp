import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("plan invite open + crew committed wiring", () => {
  it("mounts PlanInviteOpened on the shared plan page", () => {
    const page = readFileSync(join(process.cwd(), "app/plan/[id]/page.tsx"), "utf8");
    expect(page).toContain("PlanInviteOpened");
    expect(page).toMatch(/PlanInviteOpened planId=\{id\}/);
  });

  it("fires plan_invite_opened from the client marker", () => {
    const source = readFileSync(join(process.cwd(), "components/plan/PlanInviteOpened.tsx"), "utf8");
    expect(source).toContain('trackEvent("plan_invite_opened"');
    expect(source).toContain("vibe-link");
    expect(source).toContain("shared-plan");
  });

  it("sends crew_committed with routeReady and deliveryToken", () => {
    const crew = readFileSync(join(process.cwd(), "components/plan/PlanCrew.tsx"), "utf8");
    expect(crew).toContain("routeReady");
    expect(crew).toContain("deliveryToken");
    expect(crew).toContain("crewCommitted");
    expect(crew).toContain("NIGHT_CRAWL_ENGAGE_EVENT");
  });
});
