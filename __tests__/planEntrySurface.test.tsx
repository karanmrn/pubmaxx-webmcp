import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav"),
}));

vi.mock("@/components/plan/PlanComposer", () => ({
  default: () => createElement("form"),
}));

import NewPlanPage from "@/app/plan/page";

describe("new plan entry surface", () => {
  it("renders one planner entry owner", () => {
    const markup = renderToStaticMarkup(createElement(NewPlanPage));

    expect(markup.match(/<form(?:\s|>)/g) ?? []).toHaveLength(1);
  });
});
