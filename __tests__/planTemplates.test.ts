import { describe, expect, it } from "vitest";

import { PLAN_TEMPLATES, planTemplateById } from "@/lib/planTemplates";

describe("planTemplates", () => {
  it("exposes occasion templates with concierge seeds", () => {
    expect(PLAN_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const template of PLAN_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.title).toBeTruthy();
      expect(template.conciergeQuery.length).toBeGreaterThan(8);
    }
  });

  it("looks up by id", () => {
    expect(planTemplateById("quiz-night")?.label).toBe("Quiz night");
    expect(planTemplateById("quiz-night")?.blurb).toBe(
      "Quiz listings with start times.",
    );
    expect(planTemplateById("missing")).toBeNull();
  });
});
