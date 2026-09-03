import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SocialTabs from "@/components/feed/SocialTabs";

describe("Stories social tabs", () => {
  it("does not offer a geographic lane without a locality", () => {
    const html = renderToStaticMarkup(
      createElement(SocialTabs, {
        active: "london",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("Your lot");
    expect(html).toContain("London");
    expect(html).not.toContain("Nearby");
  });
});
