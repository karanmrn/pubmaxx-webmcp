import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodeCrawlStory, encodeCrawlStory, type CrawlStory } from "@/lib/crawlStory";
import {
  __resetCrawlStories,
  cleanVisibility,
  createCrawlStory,
  getCrawlStoryBySlug,
  slugify,
} from "@/lib/crawlStoryStore";

// These tests exercise the in-memory backend: createCrawlStory /
// getCrawlStoryBySlug check isSupabaseConfigured() per call, so we clear the
// Supabase env before each test. Without this, a build env that has these set
// (e.g. Vercel, whose `npm run ci` runs vitest with project env in process.env)
// pushes these calls down the Supabase branch and they fail. Same in-memory
// backend, same enrichment + draft rules the Supabase path uses, minus network.

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  __resetCrawlStories();
});

describe("slugify", () => {
  it("produces a url-safe, lowercase-kebab slug", () => {
    const slug = slugify("Last Train from Soho!", ["venue-a"]);
    // Only [a-z0-9-], and it carries a hash suffix for uniqueness.
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.startsWith("last-train-from-soho-")).toBe(true);
  });

  it("is deterministic for the same title + stops (no Date.now/Math.random)", () => {
    const a = slugify("A Tidy Chaos Loop", ["v1", "v2"]);
    const b = slugify("A Tidy Chaos Loop", ["v1", "v2"]);
    expect(a).toBe(b);
  });

  it("varies the suffix when the collision salt changes", () => {
    const zero = slugify("Same Title", ["v1"], 0);
    const one = slugify("Same Title", ["v1"], 1);
    expect(zero).not.toBe(one);
    // Same stem, different hash suffix.
    expect(zero.replace(/-[a-f0-9]{6}$/, "")).toBe(one.replace(/-[a-f0-9]{6}$/, ""));
  });

  it("has no leading, trailing, or doubled hyphens in the stem", () => {
    const slug = slugify("  --Weird   Spacing--  ", []);
    expect(slug).not.toMatch(/^-/);
    expect(slug).not.toMatch(/--/);
  });

  it("falls back to a 'crawl' stem for an emoji-only / blank title", () => {
    expect(slugify("🍺🍺🍺", []).startsWith("crawl-")).toBe(true);
    expect(slugify("", []).startsWith("crawl-")).toBe(true);
  });
});

describe("cleanVisibility", () => {
  it("allowlists visibility and defaults to public", () => {
    expect(cleanVisibility("public")).toBe("public");
    expect(cleanVisibility("unlisted")).toBe("unlisted");
    expect(cleanVisibility("draft")).toBe("draft");
    expect(cleanVisibility("wide-open")).toBe("public");
    expect(cleanVisibility(undefined)).toBe("public");
    expect(cleanVisibility(42)).toBe("public");
  });
});

describe("createCrawlStory + getCrawlStoryBySlug (in-memory)", () => {
  it("round-trips a story with ordered, enriched stops", async () => {
    const created = await createCrawlStory({
      title: "Last train from Soho",
      summary: "A tidy little chaos loop before the tube dies.",
      visibility: "public",
      vibeTags: ["chaotic", "last train", "not-a-real-tag"],
      stops: [
        { venueId: "venue-a1", note: "start here", priceGbp: 6.2 },
        { venueId: "venue-b2", priceGbp: 7.5 },
        { venueId: "venue-c3" },
      ],
    });
    expect(created).not.toBeNull();
    const slug = created!.slug;

    const story = await getCrawlStoryBySlug(slug);
    expect(story).not.toBeNull();
    expect(story!.title).toBe("Last train from Soho");
    expect(story!.summary).toBe("A tidy little chaos loop before the tube dies.");
    // Off-allowlist tag dropped; order preserved.
    expect(story!.vibeTags).toEqual(["chaotic", "last train"]);
    // Stops stay in insertion order, numbered by position.
    expect(story!.stops.map((s) => s.venueId)).toEqual(["venue-a1", "venue-b2", "venue-c3"]);
    expect(story!.stops.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(story!.stops[0].note).toBe("start here");
    // Every stop gets a resolved name (fallback when the id is unknown) + a map link.
    expect(story!.stops[0].venueName).toBeTruthy();
    expect(story!.stops[0].venueMapUrl).toContain("venue-a1");
  });

  it("returns null for an unknown slug", async () => {
    expect(await getCrawlStoryBySlug("does-not-exist-abcdef")).toBeNull();
    expect(await getCrawlStoryBySlug("")).toBeNull();
  });

  it("does not publicly return a draft story", async () => {
    const created = await createCrawlStory({
      title: "Secret unpublished crawl",
      visibility: "draft",
      stops: [{ venueId: "venue-x" }],
    });
    expect(created).not.toBeNull();
    // A draft is private (no auth → no owner who could view it): withheld exactly
    // like an unknown slug.
    expect(await getCrawlStoryBySlug(created!.slug)).toBeNull();
  });

  it("returns an unlisted story (link-only, still public to a holder of the link)", async () => {
    const created = await createCrawlStory({
      title: "Quiet unlisted loop",
      visibility: "unlisted",
      stops: [{ venueId: "venue-y" }],
    });
    const story = await getCrawlStoryBySlug(created!.slug);
    expect(story).not.toBeNull();
    expect(story!.visibility).toBe("unlisted");
  });

  it("rejects a story with no title or no stops", async () => {
    expect(await createCrawlStory({ title: "", stops: [{ venueId: "v" }] })).toBeNull();
    expect(await createCrawlStory({ title: "Has a title", stops: [] })).toBeNull();
  });
});

describe("anonymous encoded fallback still works", () => {
  it("encodes + decodes a CrawlStory round-trip independent of the store", () => {
    const sample: CrawlStory = {
      title: "Riverside amble",
      caption: "Slow pints by the Thames.",
      vibeTags: ["riverside", "quiet pint"],
      stops: [
        { venueId: "venue-r1", name: "The Prospect of Whitby", priceGbp: 6.8 },
        { venueId: "venue-r2", name: "The Grapes" },
      ],
    };
    const decoded = decodeCrawlStory(encodeCrawlStory(sample));
    expect(decoded).not.toBeNull();
    expect(decoded!.title).toBe("Riverside amble");
    expect(decoded!.stops.map((s) => s.name)).toEqual([
      "The Prospect of Whitby",
      "The Grapes",
    ]);
    expect(decoded!.vibeTags).toEqual(["riverside", "quiet pint"]);
  });
});
