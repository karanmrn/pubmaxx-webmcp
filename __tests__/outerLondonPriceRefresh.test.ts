import { describe, expect, it } from "vitest";

import { priorPublishedSourceFor } from "../scripts/harvest_outer_london_prices.mjs";

describe("outer London price refresh source selection", () => {
  it("revisits the exact first-party page that previously published a price", () => {
    expect(
      priorPublishedSourceFor(
        { website: "https://tattoo-bar.co.uk/" },
        [
          {
            website: "https://tattoo-bar.co.uk/",
            sourceUrl: "https://tattoo-bar.co.uk/menu",
            result: "priced",
          },
        ],
      ),
    ).toBe("https://tattoo-bar.co.uk/menu");
  });

  it("uses the declared official website when no prior priced page exists", () => {
    expect(
      priorPublishedSourceFor(
        { website: "https://example-pub.co.uk/" },
        [{ website: "https://example-pub.co.uk/", result: "no-price-published" }],
      ),
    ).toBe("https://example-pub.co.uk/");
  });
});
