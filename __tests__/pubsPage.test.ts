import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: vi.fn(),
}));

// The nav and the gallery are their own surfaces with their own coverage; what
// is under test is the page's own heading against its own title.
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pubs/PubsGallery", () => ({ default: () => null }));

import PubsPage, { generateMetadata } from "@/app/pubs/page";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";

/** The rendered heading, read off the page's own output. */
async function renderedHeading(): Promise<string | undefined> {
  const html = renderToStaticMarkup(await PubsPage({}));
  return html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1];
}

describe("/pubs metadata", () => {
  it("uses the same Chains heading in the page title as the on-page h1", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({
      pubs: [
        {
          id: "pub-1",
          name: "One",
          borough: "Camden",
          source: "youngs.co.uk",
          sourceLabel: "Young's",
          drinkAccent: "beer",
          drinkShelf: ["wine"],
          cheapestPrice: 4.5,
          zone: 2,
        },
        {
          id: "pub-2",
          name: "Two",
          borough: "Camden",
          source: "greene-king.co.uk",
          sourceLabel: "Greene King",
          drinkAccent: "beer",
          drinkShelf: ["gin"],
          cheapestPrice: 4.2,
          zone: 2,
        },
        {
          id: "pub-3",
          name: "Three",
          borough: "Westminster",
          source: "nicholsonspubs.co.uk",
          sourceLabel: "Nicholson's",
          drinkAccent: "beer",
          drinkShelf: ["whisky"],
          cheapestPrice: 5.1,
          zone: 1,
        },
      ],
      complete: true,
    });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Chains (3 chain pubs)");
    expect(await renderedHeading()).toBe(meta.title);
  });

  it("falls back to Chains when the scraped read is incomplete", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({
      pubs: [
        {
          id: "pub-1",
          name: "One",
          borough: "Camden",
          source: "youngs.co.uk",
          sourceLabel: "Young's",
          drinkAccent: "beer",
          drinkShelf: ["wine"],
          cheapestPrice: 4.5,
          zone: 2,
        },
      ],
      complete: false,
    });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Chains");
    expect(await renderedHeading()).toBe(meta.title);
  });
});
