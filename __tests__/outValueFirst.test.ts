// @vitest-environment jsdom

// Out leads with the night, not with an apology about it.
//
// UI audit, 2026-09-01, production, 390x844. Three findings on one page:
//
//  1. The page led with "57 more listings tonight are at places we don't list
//     yet", its source credit and a way onward, ALL above the single listing it
//     did have. The word "more" was answering nothing at that point.
//  2. "Also picked this week" answered "Picks need a fresh check." - our own
//     maintenance, shown to a drinker.
//  3. The PUBMAXX venue badge drew the Crossing X in one ink colour at 18px,
//     one line under a Ticketmaster credit, where it reads as another
//     company's logo rather than ours.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { MARK_COLORS } from "@/components/brand/PubmaxxMark";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { OUT_LISTING_VENUE_BADGE_LABEL } from "@/lib/outDesktopGrouping";
import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_STALE_LINE,
} from "@/lib/editorial";
import type { WhatsOnRow } from "@/lib/whatsOn";

const REPO_ROOT = join(__dirname, "..");
const outClient = readFileSync(join(REPO_ROOT, "app/out/OutClient.tsx"), "utf8");

const matchedRow: WhatsOnRow = {
  id: "mark-render",
  kind: "event",
  title: "Comedy",
  venueId: "venue-mark",
  placeName: "The Comedy Store",
  source: { label: "Ticketmaster", url: "https://example.com/event/mark" },
  observedAt: "2026-08-14T12:00:00.000Z",
  confidence: "listed",
};

function renderedPubPair(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(OutListingPubPair, { row: matchedRow }),
  );
  return host;
}

describe("the listings come before the line about what is missing", () => {
  it("renders the unmatched notice after the listing surface", () => {
    const surfaceAt = outClient.indexOf('className="outListingSurface"');
    const noticeAt = outClient.indexOf('data-testid="out-unmatched-notice"');
    expect(surfaceAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeGreaterThan(surfaceAt);
  });

  it("keeps the read's own status lines above the listings", () => {
    const statusAt = outClient.indexOf("outStatusLines({ body, failed })");
    const surfaceAt = outClient.indexOf('className="outListingSurface"');
    // A read that could not answer is not an apology about coverage: it says
    // the listings on screen may be incomplete, so it belongs before them.
    expect(statusAt).toBeGreaterThan(-1);
    expect(statusAt).toBeLessThan(surfaceAt);
  });

  it("keeps the notice inside the listings section it is about", () => {
    const section = outClient.slice(
      outClient.indexOf('className="outListings"'),
      outClient.indexOf("<EditorialRail />"),
    );
    expect(section).toContain('data-testid="out-unmatched-notice"');
  });
});

describe("an empty rail speaks to a drinker", () => {
  it("says what the reader gets, never what we need to do", () => {
    for (const line of [
      EDITORIAL_STALE_LINE,
      EDITORIAL_EMPTY_LINE,
      EDITORIAL_DEGRADED_EMPTY_LINE,
    ]) {
      expect(line, line).not.toMatch(/needs? a fresh|refresh|snapshot|stale|poll/i);
    }
  });

  it("keeps the three states distinguishable", () => {
    const lines = [
      EDITORIAL_STALE_LINE,
      EDITORIAL_EMPTY_LINE,
      EDITORIAL_DEGRADED_EMPTY_LINE,
    ];
    expect(new Set(lines).size).toBe(3);
    // A withheld snapshot may not claim the week is empty: it did not look.
    expect(EDITORIAL_STALE_LINE).not.toBe(EDITORIAL_EMPTY_LINE);
  });
});

describe("the venue badge wears our own mark", () => {
  it("renders coral arms and a bright ember in the venue badge", () => {
    const host = renderedPubPair();
    const mark = host.querySelector("svg.pubmaxxMark");
    expect(mark).not.toBeNull();
    const fills = mark
      ? [...mark.querySelectorAll("polygon, circle")].map((shape) =>
          shape.getAttribute("fill"),
        )
      : [];

    expect(fills.filter((fill) => fill === MARK_COLORS.coral)).toHaveLength(3);
    expect(fills).toContain(MARK_COLORS.bright);
    expect(fills).not.toContain("currentColor");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });

  it("still names the venue in words, so the mark is not the only claim", () => {
    // Asserted against the OWNING constant rather than a retyped string. A
    // guard that spells the label itself is a second copy of the thing it is
    // guarding: rename the label and this test keeps passing against words no
    // reader sees any more.
    expect(
      renderedPubPair().querySelector(".outListingPubPairLabel")?.textContent,
    ).toBe(OUT_LISTING_VENUE_BADGE_LABEL);
  });
});
