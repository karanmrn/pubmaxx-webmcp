import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});

import PintIndexEditionPage from "@/app/pint-index/[month]/page";

describe("dated Pint Index edition", () => {
  it("renders only frozen figures, never the live map-price arrival", async () => {
    const page = await PintIndexEditionPage({
      params: Promise.resolve({ month: "2026-06" }),
    });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("These figures stay put");
    expect(html).not.toContain("Right, what about your patch?");
    expect(html).not.toContain("collected 3 July 2026");
  });
});
