import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("branded 404", () => {
  const markup = renderToStaticMarkup(createElement(NotFound));

  it("carries the PUBMAXX wordmark", () => {
    expect(markup).toContain("PUBMAXX");
  });

  it("routes visitors back to the map and tonight", () => {
    expect(markup).toContain('href="/map"');
    expect(markup).toContain('href="/tonight"');
  });

  it("keeps the copy free of em dashes", () => {
    expect(markup).not.toContain("—");
  });
});
