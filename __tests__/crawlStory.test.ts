import { describe, it, expect } from "vitest";

import {
  encodeCrawlStory,
  decodeCrawlStory,
  totalGbp,
  type CrawlStory,
} from "@/lib/crawlStory";

const sample: CrawlStory = {
  title: "Last train from Soho",
  caption: "A tidy little chaos loop before the tube dies.",
  vibeTags: ["chaotic", "last train", "cheap"],
  stops: [
    { venueId: "venue-a1", name: "The Coach & Horses", priceGbp: 6.2, note: "start here" },
    { venueId: "venue-b2", name: "The French House", priceGbp: 7.5 },
    { venueId: "venue-c3", name: "Bradley's Spanish Bar", priceGbp: null },
  ],
  createdAt: "2026-07-05",
};

describe("encodeCrawlStory / decodeCrawlStory", () => {
  it("round-trips a story to an equal value", () => {
    const encoded = encodeCrawlStory(sample);
    const decoded = decodeCrawlStory(encoded);
    expect(decoded).not.toBeNull();
    // A null price is omitted on the wire, so compare against the normalised shape.
    expect(decoded).toEqual({
      title: sample.title,
      caption: sample.caption,
      vibeTags: sample.vibeTags,
      stops: [
        { venueId: "venue-a1", name: "The Coach & Horses", priceGbp: 6.2, note: "start here" },
        { venueId: "venue-b2", name: "The French House", priceGbp: 7.5 },
        { venueId: "venue-c3", name: "Bradley's Spanish Bar" },
      ],
      createdAt: "2026-07-05",
    });
  });

  it("produces a URL-safe payload (no +, /, or = padding)", () => {
    const encoded = encodeCrawlStory(sample);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("drops vibe tags outside the allowlist", () => {
    const encoded = encodeCrawlStory({
      ...sample,
      vibeTags: ["cheap", "not-a-real-tag", "riverside"],
    });
    const decoded = decodeCrawlStory(encoded);
    expect(decoded?.vibeTags).toEqual(["cheap", "riverside"]);
  });

  it("returns null (never throws) on null, empty, and garbage input", () => {
    expect(decodeCrawlStory(null)).toBeNull();
    expect(decodeCrawlStory("")).toBeNull();
    expect(decodeCrawlStory("@@garbage@@")).toBeNull();
    expect(decodeCrawlStory(undefined)).toBeNull();
    // Valid base64url that decodes to non-JSON must also be null, not a throw.
    expect(decodeCrawlStory("bm90LWpzb24")).toBeNull();
  });
});

describe("totalGbp", () => {
  it("sums stop prices, ignoring nullish ones", () => {
    expect(totalGbp(sample)).toBeCloseTo(13.7, 5);
  });

  it("is 0 for a story with no priced stops", () => {
    expect(
      totalGbp({ title: "", caption: "", vibeTags: [], stops: [{ venueId: "x", name: "X" }] }),
    ).toBe(0);
  });
});
