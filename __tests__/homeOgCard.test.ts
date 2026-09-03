import { readFileSync } from "fs";
import { join } from "path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";
import type { AboutStats } from "@/lib/aboutStats";
import {
  HOME_CARD_EYEBROW,
  HOME_CARD_HERO_ACCENT,
  HOME_CARD_HERO_LEAD,
  HOME_CARD_HERO_TAIL,
  HOME_CARD_SUPPORT,
  HomeOgCard,
  homeCardCoverage,
} from "@/lib/homeOgCard";
import { MARK_POLYGONS, Wordmark } from "@/lib/ogBrand";

// The homepage share card is the most forwarded surface the product has: a
// referral link (/r/<code>) 307s to /#referral=…, whose head is the homepage's,
// so an invite preview IS this image. It went stale twice over in ways nothing
// caught, which is what this file fences:
//
//   1. It claimed 1,908 pubs tracked while the landing hero and /about said
//      953, because the card grouped the price dataset ITSELF and its copy of
//      the read never dropped the rows carrying no price.
//   2. It carried a coral chip holding an ink-deep X, the sanctioned plaque
//      tile inverted, long after the site header had moved to the PUBMA××ING
//      wordmark.
//
// So: one derived source for the numbers, and the header's own wordmark.

const REPO_ROOT = join(__dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function stats(overrides: Partial<AboutStats> = {}): AboutStats {
  return {
    pubsTracked: 953,
    pintPricesObserved: 2788,
    cheapestPint: 1.99,
    dearestPint: 13,
    averagePint: 5.72,
    boroughsCovered: 33,
    historicPubsCited: 346,
    citiesCovered: 9,
    ...overrides,
  };
}

function renderCard(value: AboutStats): string {
  return renderToStaticMarkup(HomeOgCard({ stats: value }));
}

describe("home card figures are derived, never typed in", () => {
  it("takes every count from the stats it is handed", () => {
    expect(homeCardCoverage(stats())).toEqual([
      "953 pubs tracked",
      "2,788 prices on record",
      "London + 8 cities",
    ]);

    // A different dataset must move every figure on the card. If any of these
    // survived as a literal, this is where it would show.
    expect(
      homeCardCoverage(
        stats({ pubsTracked: 12, pintPricesObserved: 40, citiesCovered: 1 }),
      ),
    ).toEqual(["12 pubs tracked", "40 prices on record", "London"]);
  });

  it("drops a figure it does not have rather than printing a zero", () => {
    expect(
      homeCardCoverage(
        stats({ pubsTracked: 0, pintPricesObserved: 0, citiesCovered: 0 }),
      ),
    ).toEqual([]);

    const markup = renderCard(
      stats({ pubsTracked: 0, pintPricesObserved: 0, citiesCovered: 0 }),
    );
    expect(markup).not.toContain("0 pubs");
    expect(markup).not.toContain("0 prices");
    // The card still renders its brand and its promise with no counts at all.
    expect(markup).toContain(HOME_CARD_HERO_ACCENT);
  });

  it("reads the counts through lib/aboutStats and never opens the dataset itself", () => {
    const source = readSource("lib/homeOgCard.tsx");
    expect(source).toContain('from "@/lib/aboutStats"');
    expect(source).toContain("loadAboutStats()");
    // The duplicate read that produced the 1,908 claim. Neither the file path
    // nor a second grouping may come back.
    expect(source).not.toContain("pint_prices_app_dataset.json");
    expect(source).not.toContain("groupVenuePrices");
    expect(source).not.toMatch(/readFile/);
  });

  it("prints the figures it was handed", () => {
    const markup = renderCard(stats());
    expect(markup).toContain("953 pubs tracked");
    expect(markup).toContain("2,788 prices on record");
    expect(markup).toContain("London + 8 cities");
  });
});

describe("home card copy", () => {
  it("says what the landing page says", () => {
    // The card fronts the landing page, so its hero is that page's h1 and its
    // support line is that page's lede. A drift here is a share preview
    // promising something the page it opens does not say.
    const landing = readSource("components/landing/LandingPage.tsx");
    const hero = `${HOME_CARD_HERO_LEAD} ${HOME_CARD_HERO_TAIL} ${HOME_CARD_HERO_ACCENT}`;
    expect(hero).toBe("London pints can cost eight quid.");
    expect(landing).toContain("London pints can cost eight quid.");

    const ledeWords = HOME_CARD_SUPPORT.split(". ")[0];
    expect(landing.replace(/\s+/g, " ")).toContain(ledeWords);
  });

  it("keeps the retired night-OS lines off the card", () => {
    const markup = renderCard(stats());
    expect(markup).not.toContain("worth remembering");
    expect(markup).not.toContain("worth keeping");
    expect(markup).not.toContain("Last train home");
  });

  it("carries no em dash, no exclamation and no banned word", () => {
    // docs/VOICE.md house law, checked on the strings this module owns rather
    // than waiting for the tree-wide sweep to reach a card nobody reads in the
    // app.
    const lines = [
      HOME_CARD_EYEBROW,
      HOME_CARD_HERO_LEAD,
      HOME_CARD_HERO_TAIL,
      HOME_CARD_HERO_ACCENT,
      HOME_CARD_SUPPORT,
      ...homeCardCoverage(stats()),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/[—]|&mdash;|\s–\s/);
      expect(line).not.toContain("!");
      expect(line.toLowerCase()).not.toMatch(
        /\b(experience|discover|elevate|seamless|curated|unleash|empower|vibrant|effortless|robust|leverage|unlock|journey)\b/,
      );
    }
  });
});

describe("home card brand", () => {
  it("draws the site header's wordmark, not a boxed mark", () => {
    const markup = renderToStaticMarkup(Wordmark({}));
    // PUBMA + the doubled hero + ING, exactly as components/brand/
    // PubmaxxWordmark splits it.
    expect(markup).toContain("PUBMA");
    expect(markup).toContain("ING");
    // Two glyphs, the second tinted coral, and no ember: these are letterforms.
    expect(markup.match(/<svg/g)).toHaveLength(2);
    expect(markup).toContain("#ff5a5f");
    expect(markup).not.toContain("<circle");
    // The retired lockup: a coral rounded square holding an ink-deep X.
    expect(markup).not.toContain("borderRadius");
    expect(markup).not.toContain("border-radius");
    expect(markup).not.toContain("#060607");
  });

  it("cuts every card mark from the master geometry", () => {
    // lib/ogBrand re-declares the polygons because satori cannot import the
    // client component. Re-declared is fine; drifted is not.
    expect(MARK_POLYGONS.thick).toBe(MARK_GEOMETRY.thick);
    expect(MARK_POLYGONS.thinA).toBe(MARK_GEOMETRY.thinA);
    expect(MARK_POLYGONS.thinB).toBe(MARK_GEOMETRY.thinB);
  });

  it("puts the wordmark on the card", () => {
    const markup = renderCard(stats());
    expect(markup).toContain("PUBMA");
    expect(markup).toContain("pubmaxxing.com");
  });
});

describe("the invite path needs no card of its own", () => {
  it("lands a referral on the homepage, whose head names this card", () => {
    // /r/<code> redirects to /#referral=<code>. A fragment never reaches the
    // server, so the document a crawler previews is the homepage.
    const referral = readSource("app/r/[code]/route.ts");
    expect(referral).toContain('new URL("/", request.url)');
    expect(referral).toContain("referral");

    const home = readSource("app/page.tsx");
    expect(home).toContain('url: "/api/home-card"');
    expect(home).toContain('images: ["/api/home-card"]');
  });
});
