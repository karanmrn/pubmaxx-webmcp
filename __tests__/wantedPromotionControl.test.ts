import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WantedPromotionControl from "@/components/wanted/WantedPromotionControl";

describe("WantedPromotionControl", () => {
  it("requires an explicit public-list choice and exposes no private provenance", () => {
    const html = renderToStaticMarkup(createElement(WantedPromotionControl, {
      wantedId: "wanted-1",
    }));

    expect(html).toContain("Public list");
    expect(html).toContain("Want to Visit");
    expect(html).toContain("Add to public list");
    expect(html).not.toContain("sourceUrl");
    expect(html).not.toContain("note");
  });

  it("renders durable promotion state without another write action", () => {
    const html = renderToStaticMarkup(createElement(WantedPromotionControl, {
      wantedId: "wanted-1",
      promotedListType: "Want to Visit",
    }));

    expect(html).toContain("Added to Want to Visit");
    expect(html).not.toContain("Add to public list");
    expect(html).not.toContain("<select");
  });
});
