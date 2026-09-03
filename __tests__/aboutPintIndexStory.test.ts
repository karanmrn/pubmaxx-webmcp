import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PintIndexSnapshot } from "@/lib/pintIndex";

const fixtures = vi.hoisted(() => ({
  snapshot: null as unknown,
  stats: {
    pubsTracked: 2_796,
    pintPricesObserved: 2_796,
    cheapestPint: 4,
    dearestPint: 8,
    averagePint: 6,
    boroughsCovered: 33,
    historicPubsCited: 10,
    citiesCovered: 3,
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// SiteNav is a client shell with pathname/auth hooks; the about story pins
// only the server-rendered prose and brand-first hero markup.
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", { "data-testid": "site-nav", "aria-label": "PUBMAXX" }),
}));

vi.mock("@/lib/aboutStats", () => ({
  loadAboutStats: async () => fixtures.stats,
}));

vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => fixtures.snapshot,
}));

import AboutPage from "@/app/about/page";

function snapshot(
  observations: PintIndexSnapshot["observations"],
): PintIndexSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "test-snapshot",
    status: observations.length ? "published" : "empty",
    generatedAt: "2026-07-31T00:00:00.000Z",
    observationWindow: observations.length
      ? {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-31T00:00:00.000Z",
        }
      : null,
    classification: {
      version: "test",
      method: "point_in_polygon",
      sourceArtifact: "test",
      licence: "test",
    },
    sources: observations.length
      ? [
          {
            id: "source",
            kind: "official_publisher",
            publisher: "Test Brewery",
            sourceUrl: "https://example.com/prices",
            licence: null,
            publisherType: "brewery",
            officialDomain: "example.com",
          },
        ]
      : [],
    observations,
    excluded: [],
  };
}

async function renderAbout(): Promise<string> {
  const page = await AboutPage();
  return renderToStaticMarkup(createElement(() => page));
}

async function renderStoryHooks(): Promise<string> {
  const html = await renderAbout();
  const start = html.indexOf('aria-labelledby="press-hooks"');
  const end = html.indexOf('aria-labelledby="cta"', start);
  return html.slice(start, end);
}

describe("About Pint Index story", () => {
  beforeEach(() => {
    fixtures.snapshot = snapshot([]);
  });

  it("shows the public snapshot empty state instead of raw map-price counts", async () => {
    const story = await renderStoryHooks();

    expect(story).toContain("No borough league yet.");
    expect(story).toContain("See the Index status");
    expect(story).not.toContain("2,796");
    expect(story).not.toContain("currently ranks");
  });

  it("derives every populated league count from the public snapshot", async () => {
    fixtures.snapshot = snapshot([
      {
        venueId: "camden-pub",
        pubName: "Camden Pub",
        boroughCode: "camden",
        boroughName: "Camden",
        pricePence: 500,
        observedAt: "2026-07-10T00:00:00.000Z",
        sourceId: "source",
      },
      {
        venueId: "westminster-pub",
        pubName: "Westminster Pub",
        boroughCode: "westminster",
        boroughName: "Westminster",
        pricePence: 700,
        observedAt: "2026-07-11T00:00:00.000Z",
        sourceId: "source",
      },
    ]);

    const story = await renderStoryHooks();

    expect(story).toContain("currently ranks");
    expect(story).toContain("<strong>2</strong> boroughs");
    expect(story).toContain("<strong>2</strong> dated prices");
    expect(story).toContain("<strong>2</strong> pubs");
    expect(story).not.toContain("2,796");
  });
});

describe("About outings story (Wave S1)", () => {
  beforeEach(() => {
    fixtures.snapshot = snapshot([]);
  });

  it("names daytime and sober outings without inventing biography or metrics", async () => {
    const html = await renderAbout();

    expect(html).toContain("coffee and a laptop at a Spoons");
    expect(html).toContain("alcohol-free hang");
    expect(html).toContain("Food anchors stay honest");
    expect(html).toContain("Fake Wetherspoons prices");
    expect(html).toContain("second independent drinker");
    expect(html).toContain("founder-led by");
    expect(html).toContain("Karan Manoharan");
    expect(html).toContain("one map for nights out and daytime hangs");
    expect(html).not.toMatch(/small team/iu);
    expect(html).toContain(
      "where to go for a night out, a coffee, food, or a quiet afternoon",
    );
    expect(html).not.toMatch(/\b(journey|unlock|seamless|curated|discover|elevate)\b/iu);
    expect(html).not.toMatch(/co-founder|Discord|thousands of/iu);
    expect(html).not.toContain("!");
  });

  it("keeps the founder note to the owner-approved beats", async () => {
    const html = await renderAbout();

    // The note lives inside the "Who builds it" section, after the intro line.
    const teamAt = html.indexOf('aria-labelledby="team"');
    const noteAt = html.indexOf('class="aboutFounderNote"');
    expect(teamAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(teamAt);

    const note = html.slice(noteAt, html.indexOf("</figure>", noteAt));
    expect(note).not.toMatch(
      /\b(?:minute|hour|day|week|month|summer|year)s?\s+(?:away|ago)\b/iu,
    );
    // The three approved beats: the why, the price provenance states, and the
    // mission. A change back to an invented origin anecdote must fail here.
    expect(note).toContain("pint prices became hard to know");
    expect(note).toContain("source status");
    expect(note).toContain("named publisher where one is recorded");
    expect(note).toContain("publisher is not recorded");
    expect(note).toContain("drinker who logged it on a stated day");
    expect(note).toContain("nobody has logged a figure");
    expect(note).toContain("best way in the world to decide which pub");
    expect(note).toContain("Karan Manoharan, founder of PUBMAXX");
    // Provenance rule: the note claims no personal facts the site cannot
    // stand behind - no dates, no CV, no schools, no prior employers.
    expect(note).not.toMatch(/\b(19|20)\d\d\b/u);
    expect(note).not.toMatch(/university|school|degree|ex-|previously (at|worked)/iu);
    expect(note).not.toMatch(
      /\b(?:thousands?|millions?|followers?|downloads?|revenue|growth|customers?)\b/iu,
    );
    // House voice fences hold inside the note too.
    expect(note).not.toContain("—");
    expect(note).not.toContain("!");
    expect(note).not.toMatch(/\b(journey|unlock|seamless|curated|discover|elevate|experience)\b/iu);
  });

  it("names the founder on the Organization JSON-LD", async () => {
    const html = await renderAbout();

    expect(html).toContain('"founder":{"@type":"Person","name":"Karan Manoharan"');
  });

  it("leads the first viewport with PUBMAXX brand + one lede composition", async () => {
    const html = await renderAbout();

    expect(html).toContain('data-testid="site-nav"');
    expect(html).toContain('class="aboutHero"');
    expect(html).toContain('class="aboutBrand"');
    expect(html).toContain('class="aboutBrassRule"');
    expect(html).toContain('class="aboutLede"');
    // Brand signal sits ahead of the story title (nav is mocked above both).
    const brandAt = html.indexOf('class="aboutBrand"');
    const titleAt = html.indexOf('class="aboutTitle"');
    expect(brandAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(brandAt);
    expect(html.slice(brandAt, brandAt + 80)).toContain("PUBMAXX");
    // No invented biography / vanity theatre in the hero.
    expect(html).not.toMatch(/team scars|Discord|thousands of/iu);
  });
});
