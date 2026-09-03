import {
  OUT_LISTING_PUB_ABSENT_LINE,
  OUT_LISTING_VENUE_BADGE_LABEL,
  OUT_OPEN_PLANS_MIN_SENDABLE,
  groupOutListings,
  outListingGroupKey,
  outListingPubPair,
  outListingUnmatchedCount,
  outOpenPlansSectionVisible,
  outUnmatchedListingsNotice,
  OUT_UNMATCHED_PLACES_SHOWN,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import type { OutOpenPlan } from "@/lib/out";
import { describe, expect, it } from "vitest";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "kind" | "title">): WhatsOnRow {
  return {
    placeName: "The Test Arms",
    source: { label: "Ticketmaster", url: "https://example.com/event/1" },
    observedAt: "2026-08-14T12:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

function openPlan(partial: Partial<OutOpenPlan> & Pick<OutOpenPlan, "crewId" | "title">): OutOpenPlan {
  return {
    startTime: "2026-08-16T19:00:00.000Z",
    stopVenueId: "venue-1",
    stopVenueName: "The Anchor",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: {
      kind: "venue",
      name: "The Anchor",
      lat: 51.5,
      lng: -0.1,
    },
    ...partial,
  };
}

describe("out desktop grouping", () => {
  it("drops listings without a PUBMAXX venue from product groups", () => {
    const matched = row({
      id: "matched-product-row",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
    });
    const unmatched = row({
      id: "unmatched-product-row",
      kind: "event",
      title: "Arena show",
      placeName: "The O2",
    });

    const productRows = groupOutListings([unmatched, matched]).flatMap((group) =>
      group.rows.map((item) => item.id),
    );
    expect(productRows).toEqual(["matched-product-row"]);
  });

  it("drops whitespace-only venue ids and canonicalises padded venue ids", () => {
    const padded = row({
      id: "padded-venue-row",
      kind: "event",
      title: "Comedy",
      venueId: " venue-123 ",
    });
    const whitespaceOnly = row({
      id: "whitespace-venue-row",
      kind: "event",
      title: "Arena show",
      venueId: " \t ",
    });

    const productRows = groupOutListings([whitespaceOnly, padded]).flatMap((group) =>
      group.rows.map((item) => item.id),
    );
    expect(productRows).toEqual(["padded-venue-row"]);
    expect(outListingGroupKey(padded)).toMatchObject({
      key: "venue:venue-123",
      kind: "venue",
    });
    expect(outListingPubPair(padded)).toEqual({
      status: "matched",
      placeName: "The Test Arms",
      mapHref: "/map?sel=venue-123",
    });
    expect(outListingUnmatchedCount([padded, whitespaceOnly])).toBe(1);
  });

  it("groups matched listings by venue and excludes unresolved area rows", () => {
    const venueA = row({
      id: "gig-a",
      kind: "music",
      title: "Early set",
      venueId: "venue-soho",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T19:00:00.000Z",
    });
    const venueB = row({
      id: "gig-b",
      kind: "music",
      title: "Late set",
      venueId: "venue-soho",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T22:00:00.000Z",
    });
    const areaOnly = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Pub quiz",
      area: "camden",
      placeName: "The Camden Head",
      startsAt: "2026-08-16T20:00:00.000Z",
    });

    const groups = groupOutListings([areaOnly, venueB, venueA]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("venue:venue-soho");
    expect(groups[0]?.rows.map((item) => item.id)).toEqual(["gig-a", "gig-b"]);
    expect(outListingGroupKey(venueA).kind).toBe("venue");
    expect(outListingGroupKey(areaOnly).kind).toBe("area");
  });

  it("pairs a resolved pub beside a gig and names honest absence without one", () => {
    const matched = row({
      id: "matched",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
      placeName: "The Comedy Store",
    });
    const absent = row({
      id: "absent",
      kind: "event",
      title: "Arena show",
      placeName: "The O2",
    });

    expect(outListingPubPair(matched)).toEqual({
      status: "matched",
      placeName: "The Comedy Store",
      mapHref: "/map?sel=venue-123",
    });
    expect(outListingPubPair(absent)).toEqual({
      status: "absent",
      line: OUT_LISTING_PUB_ABSENT_LINE,
    });
  });

  it("counts unmatched events once for the page-level state", () => {
    const matched = row({
      id: "matched-count",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
    });
    const absent = row({ id: "absent-count", kind: "event", title: "Arena show" });

    expect(outListingUnmatchedCount([matched, absent, absent])).toBe(2);
  });

  it("does not repeat an unmatched-pub line beside every row", () => {
    const html = renderToStaticMarkup(
      createElement(OutListingPubPair, {
        row: row({ id: "absent-render", kind: "event", title: "Arena show" }),
      }),
    );

    expect(html).toBe("");
    expect(html).not.toContain(OUT_LISTING_PUB_ABSENT_LINE);
  });

  it("labels a matched event place as a PUBMAXX venue", () => {
    const html = renderToStaticMarkup(
      createElement(OutListingPubPair, {
        row: row({
          id: "arena-render",
          kind: "event",
          title: "ABBA Voyage",
          placeName: "ABBA Arena",
          venueId: "venue-abba-arena",
        }),
      }),
    );

    expect(html).toContain(`>${OUT_LISTING_VENUE_BADGE_LABEL}<`);
    expect(html).not.toContain(">PUBMAXX pub<");
  });

  it("keeps desktop listing columns balanced inside a centred surface", () => {
    const css = readFileSync(join(process.cwd(), "app/out/out.css"), "utf8");
    const desktop = css.match(/@media \(min-width: 1024px\) \{([\s\S]*)/)?.[1] ?? "";
    expect(desktop).toMatch(
      /\.outListingSurface\s*\{[^}]*max-width:\s*1120px;[^}]*margin-inline:\s*auto;/,
    );
  });

  it("shows Open plans when one sendable plan exists", () => {
    const sendable = openPlan({ crewId: "crew-1", title: "Soft plan" });
    const unsendable = openPlan({
      crewId: "crew-2",
      title: "No meet point",
      meetingPoint: null,
    });

    expect(OUT_OPEN_PLANS_MIN_SENDABLE).toBe(1);
    expect(sendableOpenPlans([sendable, unsendable, sendable, sendable])).toHaveLength(3);
    expect(outOpenPlansSectionVisible([sendable, unsendable])).toBe(true);
    expect(outOpenPlansSectionVisible([unsendable])).toBe(false);
  });
});

describe("outUnmatchedListingsNotice", () => {
  // When every listing is at an unlisted place, /out still names the hidden
  // supply so a populated event feed cannot read as an empty city.
  const unmatched = (id: string, placeName: string, label = "Ticketmaster") =>
    row({
      id,
      kind: "event",
      title: `Show at ${placeName}`,
      placeName,
      source: { label, url: `https://example.com/${id}` },
    });
  const matched = row({ id: "matched", kind: "music", title: "Gig", venueId: "venue-1" });

  it("is silent when every listing is at a listed pub, and when there are no rows", () => {
    expect(outUnmatchedListingsNotice([], "tonight", "ready")).toBeNull();
    expect(outUnmatchedListingsNotice([matched], "tonight", "ready")).toBeNull();
  });

  it("names listings when the match ran and none landed on a listed pub", () => {
    const notice = outUnmatchedListingsNotice(
      [
        unmatched("a", "Jazz Cafe"),
        unmatched("b", "Up The Creek"),
        unmatched("c", "Soul Mama"),
        unmatched("d", "The Comedy Store"),
      ],
      "tonight",
      "ready",
    );
    expect(notice?.line).toBe("4 listings tonight are at places we don't list yet.");
  });

  it("keeps the hidden-row count without place names when the pub list is not empty", () => {
    const notice = outUnmatchedListingsNotice(
      [matched, unmatched("a", "The O2"), unmatched("b", "Wembley Arena")],
      "tonight",
      "ready",
    );
    expect(notice?.line).toBe("2 more listings tonight are at places we don't list yet.");
    expect(notice?.places).toBe("");
  });

  it("reads as one more listing beside a matched card", () => {
    expect(
      outUnmatchedListingsNotice([matched, unmatched("a", "The O2")], "tonight", "ready")?.line,
    ).toBe("1 more listing tonight is at a place we don't list yet.");
  });

  it("omits unmatched place names when a matched venue card is shown", () => {
    const notice = outUnmatchedListingsNotice(
      [matched, unmatched("a", "The O2", "ticketmaster")],
      "tonight",
      "ready",
    );
    expect(notice?.line).toBe("1 more listing tonight is at a place we don't list yet.");
    expect(notice?.places).toBe("");
    expect(notice?.credits.map((credit) => credit.label)).toEqual(["Ticketmaster"]);
    expect(notice?.way).toEqual({ href: "/tonight", label: "See what else is on tonight" });
  });

  it("names the window the chip asked for and sends the other days to the map", () => {
    const tomorrow = outUnmatchedListingsNotice([matched, unmatched("a", "The O2")], "tomorrow", "ready");
    expect(tomorrow?.line).toBe("1 more listing tomorrow is at a place we don't list yet.");
    expect(tomorrow?.way).toEqual({ href: "/map", label: "Find a pub on the map" });
    const weekend = outUnmatchedListingsNotice([matched, unmatched("a", "The O2")], "weekend", "ready");
    expect(weekend?.line).toBe("1 more listing at the weekend is at a place we don't list yet.");
    expect(weekend?.way.href).toBe("/map");
  });

  it("omits place inventory beside a matched card even with many hidden places", () => {
    const rows = [
      matched,
      ...Array.from({ length: OUT_UNMATCHED_PLACES_SHOWN + 2 }, (_, index) =>
        unmatched(`r${index}`, `Place ${index + 1}`),
      ),
    ];
    // Two shows at the same place are one place.
    rows.push(unmatched("dup", "Place 1"));
    const notice = outUnmatchedListingsNotice(rows, "tonight", "ready");
    expect(notice?.line).toBe(
      `${OUT_UNMATCHED_PLACES_SHOWN + 3} more listings tonight are at places we don't list yet.`,
    );
    expect(notice?.places).toBe("");
  });

  it("credits every provider behind the hidden rows, spelled the way the cards spell it", () => {
    const notice = outUnmatchedListingsNotice(
      [
        matched,
        unmatched("a", "The O2", "ticketmaster"),
        unmatched("b", "Corsica Studios", "common"),
      ],
      "tonight",
      "ready",
    );
    expect(notice?.credits.map((credit) => credit.label)).toEqual(["Ticketmaster", "Common"]);
  });

  it("says the check could not run rather than claiming the places are unlisted", () => {
    const notice = outUnmatchedListingsNotice(
      [unmatched("a", "The Lexington"), unmatched("b", "The O2")],
      "tonight",
      "unavailable",
    );
    expect(notice?.line).toBe(
      "We couldn't check which of tonight's 2 listings are at a pub we list.",
    );
    expect(notice?.places).toBe("The Lexington and The O2.");
    expect(notice?.way.href).toBe("/tonight");
  });

  it("keeps place names when matching is unavailable even beside a resolved venue", () => {
    const notice = outUnmatchedListingsNotice(
      [matched, unmatched("a", "The O2")],
      "tonight",
      "unavailable",
    );
    expect(notice?.line).toBe(
      "We couldn't check which of tonight's 1 listing is at a pub we list.",
    );
    expect(notice?.places).toBe("The O2.");
  });

  it("treats a body from before the match field as unavailable", () => {
    expect(outUnmatchedListingsNotice([unmatched("a", "The O2")], "tonight", undefined)?.line).toBe(
      "We couldn't check which of tonight's 1 listing is at a pub we list.",
    );
  });

  it("uses the pre-cap count while omitting place names beside a matched card", () => {
    const notice = outUnmatchedListingsNotice(
      [matched, unmatched("a", "The O2")],
      "tonight",
      "ready",
      { unmatchedCount: 4, unmatchedPlaces: ["The O2"], unmatchedSources: ["Ticketmaster"] },
    );
    expect(notice?.line).toBe("4 more listings tonight are at places we don't list yet.");
    expect(notice?.places).toBe("");
    expect(notice?.credits.map((credit) => credit.label)).toEqual(["Ticketmaster"]);
  });

  it("names hidden rows when no matched card is served", () => {
    expect(
      outUnmatchedListingsNotice(
        [unmatched("a", "The O2")],
        "tonight",
        "ready",
        {
          unmatchedCount: 1,
          unmatchedPlaces: ["The O2"],
          unmatchedPlaceCount: 1,
          unmatchedSources: ["Ticketmaster"],
        },
      )?.line,
    ).toBe("1 listing tonight is at a place we don't list yet.");
  });

  it("omits response place inventory when a matched card is present", () => {
    const notice = outUnmatchedListingsNotice(
      [matched, unmatched("a", "Place 1")],
      "tonight",
      "ready",
      {
        unmatchedCount: 8,
        unmatchedPlaces: Array.from({ length: OUT_UNMATCHED_PLACES_SHOWN }, (_, index) =>
          `Place ${index + 1}`,
        ),
        unmatchedPlaceCount: 8,
        unmatchedSources: ["Ticketmaster"],
      },
    );
    expect(notice?.places).toBe("");
  });
});
