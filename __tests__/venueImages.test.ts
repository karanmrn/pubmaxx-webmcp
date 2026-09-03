import { describe, expect, it } from "vitest";

import {
  directVenueImageUrl,
  resolveVenueImage,
  VENUE_IMAGE_PROVENANCE_LABEL,
} from "@/lib/venueImages";

describe("directVenueImageUrl", () => {
  it("keeps direct http and https venue image URLs", () => {
    expect(directVenueImageUrl("https://live.staticflickr.com/pub.jpg")).toBe(
      "https://live.staticflickr.com/pub.jpg",
    );
    expect(directVenueImageUrl("http://example.com/pub.jpg")).toBe(
      "http://example.com/pub.jpg",
    );
  });

  it("rejects redirect/share hosts that do not render as direct images", () => {
    expect(directVenueImageUrl("https://images.app.goo.gl/abc")).toBe("");
    expect(directVenueImageUrl("https://search.app.goo.gl/abc")).toBe("");
  });

  it("rejects invalid or non-web URLs", () => {
    expect(directVenueImageUrl("not a url")).toBe("");
    expect(directVenueImageUrl("javascript:alert(1)")).toBe("");
    expect(directVenueImageUrl("")).toBe("");
  });
});

// E3′ — one shared source-pick + provenance resolver behind VenueImage
// (components/media/VenueImage.tsx). These tests exercise the pure logic;
// the component itself is DOM-only and covered by the Playwright shots.
describe("resolveVenueImage", () => {
  it("picks the first source in priority order — chain before community", () => {
    const resolved = resolveVenueImage([
      { url: "https://pub.example.com/photo.jpg", provenance: "chain" },
      { url: "https://storage.supabase.co/pint.jpg", provenance: "community" },
    ]);
    expect(resolved).toEqual({
      url: "/api/image-proxy?src=" + encodeURIComponent("https://pub.example.com/photo.jpg"),
      provenance: "chain",
    });
  });

  it("falls through to the next source when an earlier one is empty/missing", () => {
    const resolved = resolveVenueImage([
      { url: null, provenance: "chain" },
      { url: "https://storage.supabase.co/pint.jpg", provenance: "community" },
    ]);
    expect(resolved).toEqual({
      url: "https://storage.supabase.co/pint.jpg",
      provenance: "community",
    });
  });

  it("falls through to the next source when an earlier one is blocked/invalid", () => {
    const resolved = resolveVenueImage([
      { url: "https://images.app.goo.gl/abc", provenance: "chain" },
      { url: "https://storage.supabase.co/pint.jpg", provenance: "community" },
    ]);
    expect(resolved?.provenance).toBe("community");
  });

  it("passes through an already-proxied chain URL instead of double-proxying it", () => {
    const alreadyProxied = "/api/image-proxy?src=" + encodeURIComponent("https://pub.example.com/a.jpg");
    const resolved = resolveVenueImage([{ url: alreadyProxied, provenance: "chain" }]);
    expect(resolved).toEqual({ url: alreadyProxied, provenance: "chain" });
  });

  it("rejects a malformed pre-proxied chain URL and falls through to community", () => {
    // Missing/blocked/invalid ?src must not become a guaranteed-broken <img>
    // that suppresses the community fallback.
    const community = "https://storage.supabase.co/pint.jpg";
    for (const bad of [
      "/api/image-proxy?nope=1",
      "/api/image-proxy?src=",
      "/api/image-proxy?src=not%20a%20url",
      "/api/image-proxy?src=" + encodeURIComponent("javascript:alert(1)"),
      "/api/image-proxy?src=" + encodeURIComponent("https://images.app.goo.gl/abc"),
    ]) {
      const resolved = resolveVenueImage([
        { url: bad, provenance: "chain" },
        { url: community, provenance: "community" },
      ]);
      expect(resolved).toEqual({ url: community, provenance: "community" });
    }
  });

  it("skips a candidate whose resolved URL already failed to load (chain fails → community renders)", () => {
    const chain = "https://pub.example.com/photo.jpg";
    const chainResolved = "/api/image-proxy?src=" + encodeURIComponent(chain);
    const community = "https://storage.supabase.co/pint.jpg";
    const sources = [
      { url: chain, provenance: "chain" as const },
      { url: community, provenance: "community" as const },
    ];

    // First pass: chain wins.
    expect(resolveVenueImage(sources)?.url).toBe(chainResolved);
    // Chain <img> errored → excluded → community renders, honestly labelled.
    expect(resolveVenueImage(sources, new Set([chainResolved]))).toEqual({
      url: community,
      provenance: "community",
    });
    // Both failed → null → gradient fallback, never an unknown photo.
    expect(resolveVenueImage(sources, new Set([chainResolved, community]))).toBeNull();
  });

  it("returns null when nothing resolves — the honest gradient-fallback case", () => {
    expect(resolveVenueImage([])).toBeNull();
    expect(
      resolveVenueImage([
        { url: undefined, provenance: "chain" },
        { url: "", provenance: "community" },
      ]),
    ).toBeNull();
  });

  it("has a distinct, honest label per provenance", () => {
    expect(VENUE_IMAGE_PROVENANCE_LABEL.chain).not.toBe(VENUE_IMAGE_PROVENANCE_LABEL.community);
    expect(VENUE_IMAGE_PROVENANCE_LABEL.chain).toMatch(/pub website/i);
    expect(VENUE_IMAGE_PROVENANCE_LABEL.community).toMatch(/community/i);
  });
});
