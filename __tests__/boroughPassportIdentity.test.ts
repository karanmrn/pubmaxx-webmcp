import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BoroughPassportSlice from "@/components/borough/BoroughPassportSlice";

describe("borough passport viewer identity", () => {
  it("keeps viewer-owned stats neutral while identity is unresolved", () => {
    const markup = renderToStaticMarkup(
      createElement(BoroughPassportSlice, {
        boroughName: "Hackney",
        venueIds: ["venue-1"],
      }),
    );

    expect(markup).toContain("boroughPassportLoading");
    expect(markup).not.toContain("Your Hackney passport");
    expect(markup).not.toMatch(/<dd>0<\/dd>/);
  });
});
