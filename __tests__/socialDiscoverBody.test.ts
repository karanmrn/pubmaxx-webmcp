import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscoverBody } from "@/app/discover/DiscoverPageClient";

describe("embedded Social discovery", () => {
  it("reuses the public discovery body without nested page landmarks or chrome", () => {
    const html = renderToStaticMarkup(
      createElement(DiscoverBody, {
        rivalry: [],
        heritageCrawls: [],
        embedded: true,
      }),
    );

    expect(html).toContain("Choose your drink");
    expect(html).toContain("<h2");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain('aria-label="Site navigation"');
  });
});
