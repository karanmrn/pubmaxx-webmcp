// @vitest-environment jsdom

// D3 (activation report): after a chip tap on the phone, the generated route
// sat below the fold — #plan-route-status at y 1548 on an 844px viewport with
// scrollY 0 and focus on body. revealPlanRouteStatus is the fix: it takes the
// viewport to the route status and moves focus onto it, jumping instead of
// gliding when the reader prefers reduced motion.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  planRouteRevealBehavior,
  revealPlanRouteStatus,
} from "@/components/plan/PlanComposer";

function mountStatus(): { status: HTMLElement; scrollIntoView: ReturnType<typeof vi.fn> } {
  const status = document.createElement("p");
  status.id = "plan-route-status";
  const scrollIntoView = vi.fn();
  status.scrollIntoView = scrollIntoView as unknown as typeof status.scrollIntoView;
  document.body.appendChild(status);
  return { status, scrollIntoView };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("planRouteRevealBehavior", () => {
  it("glides by default and jumps under reduced motion — but always moves", () => {
    expect(planRouteRevealBehavior(false)).toBe("smooth");
    expect(planRouteRevealBehavior(true)).toBe("auto");
  });
});

describe("revealPlanRouteStatus", () => {
  it("scrolls the route status into view and focuses it", () => {
    const { status, scrollIntoView } = mountStatus();

    revealPlanRouteStatus(document, false);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(status);
  });

  it("jumps instead of gliding when reduced motion is preferred", () => {
    const { scrollIntoView } = mountStatus();

    revealPlanRouteStatus(document, true);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("reads prefers-reduced-motion when the caller does not decide", () => {
    const { scrollIntoView } = mountStatus();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );

    revealPlanRouteStatus(document);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("does nothing when no route status is on the page", () => {
    expect(() => revealPlanRouteStatus(document, false)).not.toThrow();
  });
});
