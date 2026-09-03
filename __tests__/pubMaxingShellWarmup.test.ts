import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const warmup = vi.hoisted(() => ({
  warmCityMapFirstPaint: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      lifecycle.effects.push(effect);
    },
  };
});

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { className: "map-stub" }),
}));
vi.mock("@/lib/mapWarmup", () => warmup);

import PubMaxingShell from "@/components/PubMaxingShell";

describe("PubMaxingShell first-paint warmup", () => {
  beforeEach(() => {
    lifecycle.effects.length = 0;
    warmup.warmCityMapFirstPaint.mockClear();
  });

  it("does not start a dynamic map import during render", () => {
    renderToStaticMarkup(createElement(PubMaxingShell, { cityId: "london" }));

    expect(warmup.warmCityMapFirstPaint).not.toHaveBeenCalled();
  });

  it("warms the active city after commit and follows a city change", () => {
    renderToStaticMarkup(createElement(PubMaxingShell, { cityId: "london" }));
    lifecycle.effects[0]?.();
    expect(warmup.warmCityMapFirstPaint).toHaveBeenCalledWith("london");

    lifecycle.effects.length = 0;
    warmup.warmCityMapFirstPaint.mockClear();
    renderToStaticMarkup(createElement(PubMaxingShell, { cityId: "manchester" }));
    lifecycle.effects[0]?.();
    expect(warmup.warmCityMapFirstPaint).toHaveBeenCalledWith("manchester");
  });
});
