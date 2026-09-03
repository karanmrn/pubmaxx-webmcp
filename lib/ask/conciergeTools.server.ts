import "server-only";

// Server handlers for the five Pub Pal V0.1 concierge tools (ADR 0014, R-015).
//
// Every handler is a thin call into a lane that already exists - the listed
// venue index, the near-me ranking, the community price store, the What's-On
// spine - plus the pure policy in `lib/ask/conciergeTools.ts`. Nothing here
// derives a price, widens a trust gate, or writes anything.

import {
  CHEAPEST_NEAR_NO_ANCHOR,
  CROWD_READING_NOT_LIVE,
  cheapestNearEmptyLine,
  cheapestNearHeadline,
  cheapestNearRowNote,
  findDeskEmptyLine,
  findDeskRowNote,
  isDeicticPlaceWord,
  isPlaceShapedWord,
  OCCUPANCY_LEVEL_LABELS,
  occupancyReportOutcome,
  occupancyStoreState,
  splitTonightRowsByNow,
  tonightNowLine,
  VENUE_DRINKS_NO_VENUE,
  venueDrinkRowNote,
  venueDrinksAnswerLine,
  type CheapestNearAnchor,
  type FindDeskEmptyReason,
} from "@/lib/ask/conciergeTools";
import { loadDeskVenues } from "@/lib/ask/deskVenues.server";
import type {
  AskToolArgs,
  AskToolContext,
  AskToolResult,
} from "@/lib/ask/toolContract";
import type { AskCard, AskProposal, AskSource } from "@/lib/ask/types";
import {
  communityStampLabel,
  drivesMap,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { readCommunityPricesWithStatus } from "@/lib/communityPriceStore";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { DEFAULT_DRINK_LANE, orderVenueDrinkPrices } from "@/lib/drinkLanes";
import {
  rankBoroughCheapest,
  rankCityCheapest,
  rankNearMe,
  type NearMeCard,
  type PricedPoint,
} from "@/lib/nearMeAnswer";
import { whatsOnBarePriceGbp } from "@/lib/whatsOn";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import { filterRowsByArea } from "@/lib/concierge/whatsOn";

const DIRECTORY: AskSource = { label: "On record", kind: "directory" };
const PEOPLE_LOGGED: AskSource = {
  label: "People-logged",
  kind: "community-price",
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function limitOf(value: unknown, fallback: number, cap: number): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(cap, Math.max(1, Math.floor(raw)));
}

/**
 * A named pub.
 *
 * `"strict"` drops the substring pass, and it is what a ROUTED name gets: a
 * word the drinker offered as a place, matched loosely, lands on any pub
 * holding those letters, which is how "Camden" once answered "Camden Head".
 */
function withoutLeadingArticle(value: string): string {
  return value.trim().toLowerCase().replace(/^the\s+/, "");
}

function matchVenue(
  venues: readonly ConciergeVenue[],
  needle: string,
  mode: "loose" | "strict" = "loose",
): ConciergeVenue | null {
  const text = needle.trim().toLowerCase();
  if (!text) return null;
  const bare = withoutLeadingArticle(text);
  // An EXACT name, article or not, is the pub they named: the router strips
  // "the" before this, so "The Angel" arrives as "Angel" and must still find
  // The Angel.
  const exact =
    venues.find((v) => v.name.toLowerCase() === text) ??
    venues.find((v) => withoutLeadingArticle(v.name) === bare);
  if (exact) return exact;
  // Past an exact name, a place-shaped word may never land on a name-alike pub:
  // "Angel" is Islington, not The Angel Hillingdon on a prefix.
  if (isPlaceShapedWord(needle)) return null;
  return (
    venues.find((v) => withoutLeadingArticle(v.name).startsWith(bare)) ??
    (mode === "loose"
      ? (venues.find((v) => v.name.toLowerCase().includes(text)) ?? null)
      : null)
  );
}

function matchArea(
  venues: readonly { area: string }[],
  needle: string,
): string | null {
  const text = needle.trim().toLowerCase();
  if (!text) return null;
  const hit = venues.find((v) => v.area.trim().toLowerCase() === text);
  return hit ? hit.area : null;
}

function toPricedPoints(venues: readonly ConciergeVenue[]): PricedPoint[] {
  return venues.map((venue) => ({
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    cheapestPrice: venue.cheapestPrice,
    borough: venue.area,
  }));
}

function openProposal(venueId: string, name: string): AskProposal {
  return {
    id: `open:${venueId}`.slice(0, 80),
    kind: "open_venue",
    label: `Open ${name}`,
    venueId,
  };
}

// ---------------------------------------------------------------------------

export async function toolCheapestPintNear(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venues = await loadConciergeVenues(ctx.cityId);
  if (venues.length === 0) {
    return {
      ok: false,
      tool: "cheapest_pint_near",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: cheapestNearEmptyLine(
        { kind: "area", area: "London" },
        "unavailable",
      ),
      degraded: true,
    };
  }

  const venueId = str(args.venueId);
  // "near me" is not a place. A word that only names the reader's own position
  // is refused here, because this tool answers from a pub or an area alone.
  const areaArg = isDeicticPlaceWord(args.area) ? "" : str(args.area);
  const venueNameArg = isDeicticPlaceWord(args.venueName)
    ? ""
    : str(args.venueName);
  // An AREA word is answered as an area or not at all. The pack files a pub
  // under its borough, so a district it cannot place ("Angel") has no area to
  // rank and must never become the pub of that name on the other side of the
  // city. A named CENTRE still resolves to its pub, and a centre that names a
  // borough is read as that borough.
  const isLondonArea = areaArg.toLowerCase() === "london";
  // District words stay refused here. Only known boroughs scope cheapest pints.
  const areaFromArea = areaArg ? matchArea(venues, areaArg) : null;
  const areaFromVenueName =
    !areaFromArea && venueNameArg ? matchArea(venues, venueNameArg) : null;
  const area = isLondonArea
    ? "London"
    : areaFromArea ?? areaFromVenueName;
  const anchorVenue =
    (venueId ? venues.find((v) => v.id === venueId) : null) ??
    (areaFromVenueName ? null : matchVenue(venues, venueNameArg));

  let anchor: CheapestNearAnchor | null = null;
  if (anchorVenue) {
    anchor = {
      kind: "venue",
      venueId: anchorVenue.id,
      name: anchorVenue.name,
      area: anchorVenue.area,
    };
  } else if (area) {
    anchor = { kind: "area", area };
  }

  if (!anchor) {
    return {
      ok: false,
      tool: "cheapest_pint_near",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: CHEAPEST_NEAR_NO_ANCHOR,
    };
  }

  const limit = limitOf(args.limit, 4, 5);
  const points = toPricedPoints(venues);
  let rows: NearMeCard[];
  let scope: "walkable" | "widened" | "none";
  if (anchor.kind === "venue" && anchorVenue) {
    const answer = rankNearMe(anchorVenue.lat, anchorVenue.lng, points, {
      maxAnswers: limit + 1,
    });
    // The anchor itself is not an answer to "cheapest pint NEAR it".
    rows = answer.cards.filter((card) => card.id !== anchorVenue.id).slice(0, limit);
    scope = answer.scope;
  } else {
    rows =
      anchor.area.toLowerCase() === "london"
        ? rankCityCheapest(points, limit)
        : rankBoroughCheapest(points, anchor.area, limit);
    scope = rows.length > 0 ? "walkable" : "none";
  }

  if (rows.length === 0) {
    return {
      ok: true,
      tool: "cheapest_pint_near",
      data: { anchor, rows: [] },
      provenance: [DIRECTORY],
      cards: [],
      proposals: [],
      answerHint: cheapestNearEmptyLine(anchor, "ready"),
    };
  }

  const cards: AskCard[] = rows.map((row) => ({
    key: `cheapest:${row.id}`,
    venueId: row.id,
    title: row.name,
    place: row.borough,
    note: cheapestNearRowNote({
      walkMinutes: row.walkMinutes ?? null,
    }),
    price: row.cheapestPrice,
    provenance: DIRECTORY,
  }));

  const cheapest = rows[0];
  return {
    ok: true,
    tool: "cheapest_pint_near",
    data: { anchor, scope, rows },
    provenance: [DIRECTORY],
    cards,
    proposals: cards
      .slice(0, 3)
      .map((card) => openProposal(card.venueId, card.title)),
    answerHint: `${cheapestNearHeadline(anchor, scope)}: ${cheapest.name} at £${cheapest.cheapestPrice.toFixed(2)}.`,
  };
}

// ---------------------------------------------------------------------------

export async function toolTonightNow(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const area = str(args.area) || null;
  const now = ctx.now ?? Date.now();
  const unavailable = (): AskToolResult => ({
    ok: false,
    tool: "tonight_now",
    data: null,
    provenance: [],
    cards: [],
    proposals: [],
    answerHint: tonightNowLine({ area, onNow: 0, later: 0, read: "unavailable" }),
    degraded: true,
  });
  try {
    const { rows, kindObservedAt, readStatus } = await loadWhatsOn(
      { window: "tonight" },
      { now },
    );
    // A bundled read that could not run is not a city with nothing on. Saying
    // "Nothing sourced for tonight" here would be the exact claim the honesty
    // law forbids, so it takes the same way out a thrown read takes.
    if (readStatus === "degraded") return unavailable();
    const scoped = area ? filterRowsByArea(rows, area) : rows;
    const split = splitTonightRowsByNow(scoped, now);
    const cards: AskCard[] = [...split.onNow, ...split.later, ...split.dateOnly]
      .slice(0, 6)
      .map((row, index) => ({
        key: row.id || `now-${index}`,
        venueId: row.venueId ?? "",
        title: row.title,
        place: row.placeName,
        // A date-only listing gets its own source-stated line. Saying "still to
        // start" would be a claim about a start time the source withheld.
        note: split.dateOnly.includes(row)
          ? (row.timeEvidence ?? "")
          : split.onNow.includes(row)
            ? "On right now"
            : "Still to start tonight",
        price: whatsOnBarePriceGbp(row),
        provenance: {
          label: row.source?.label || "What's On",
          ...(row.source?.url ? { url: row.source.url } : {}),
          kind: "whats-on" as const,
        },
      }));
    const line = tonightNowLine({
      area,
      onNow: split.onNow.length,
      later: split.later.length,
      dateOnly: split.dateOnly.length,
      read: "ready",
    });
    return {
      ok: true,
      tool: "tonight_now",
      data: {
        area,
        onNow: split.onNow.length,
        later: split.later.length,
        dateOnly: split.dateOnly.length,
        kindObservedAt,
      },
      provenance: cards
        .map((card) => card.provenance)
        .filter((source): source is AskSource => Boolean(source)),
      cards,
      proposals: cards
        .filter((card) => card.venueId)
        .slice(0, 3)
        .map((card) => openProposal(card.venueId, card.title)),
      answerHint: `${line} ${CROWD_READING_NOT_LIVE}`,
    };
  } catch {
    return unavailable();
  }
}

// ---------------------------------------------------------------------------

export async function toolVenueDrinks(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venues = await loadConciergeVenues(ctx.cityId);
  const venueId = str(args.venueId);
  // This tool reads ONE pub. A routed name is matched on an exact or prefix
  // name only, and a word that names a borough is refused outright, because a
  // substring pass turns "Camden" into "Camden Head" and answers about a pub
  // the drinker never asked about.
  const venueNameArg = str(args.venueName);
  const namesArea = venueNameArg
    ? matchArea(venues, venueNameArg) !== null
    : false;
  const venue =
    (venueId ? venues.find((v) => v.id === venueId) : null) ??
    (namesArea ? null : matchVenue(venues, venueNameArg, "strict")) ??
    (venueNameArg ? null : matchVenue(venues, ctx.query, "strict"));

  if (!venue) {
    return {
      ok: false,
      tool: "venue_drinks",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: VENUE_DRINKS_NO_VENUE,
    };
  }

  const now = ctx.now ?? Date.now();
  const read = await readCommunityPricesWithStatus(venue.id, now);
  const status = read.degraded ? "unavailable" : "ready";
  const rows = orderVenueDrinkPrices(read.prices, DEFAULT_DRINK_LANE);

  const cards: AskCard[] = rows.map((row, index) => ({
    key: `${venue.id}:drink-${index}`,
    venueId: venue.id,
    title: `${row.label} at ${venue.name}`,
    place: venue.area,
    note: venueDrinkRowNote({
      label: row.label,
      day: communityStampLabel(row.price.submittedAt, now),
      category: row.category,
      price: row.price,
      pintDropAt: undefined,
      now,
    }),
    price: row.price.priceGbp,
    provenance: PEOPLE_LOGGED,
  }));

  if (venue.cheapestPrice != null) {
    cards.push({
      key: `${venue.id}:listed`,
      venueId: venue.id,
      title: `${venue.name} listed pint`,
      place: venue.area,
      note: "Current recorded pint on the listed index.",
      price: venue.cheapestPrice,
      provenance: DIRECTORY,
    });
  }

  const answerHint = venueDrinksAnswerLine({
    venueName: venue.name,
    figures: cards.length,
    read: status,
  });

  return {
    ok: true,
    tool: "venue_drinks",
    data: {
      venueId: venue.id,
      status,
      drinks: rows.map((row) => ({
        category: row.category,
        priceGbp: row.price.priceGbp,
        submittedAt: row.price.submittedAt,
        corroborated: drivesMap(row.price as CommunityPrice, now),
      })),
      listedPint: venue.cheapestPrice,
    },
    provenance: [
      ...(rows.length > 0 ? [PEOPLE_LOGGED] : []),
      ...(venue.cheapestPrice != null ? [DIRECTORY] : []),
    ],
    cards,
    proposals: [openProposal(venue.id, venue.name)],
    answerHint,
    ...(read.degraded ? { degraded: true } : {}),
  };
}

// ---------------------------------------------------------------------------

export async function toolFindDesk(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const area = str(args.area) || null;
  const limit = limitOf(args.limit, 4, 6);
  const read = await loadDeskVenues(ctx.cityId);

  // The area word is resolved against the places list's OWN area values, the
  // same seam `cheapest_pint_near` uses, so the two tools agree on what an area
  // word means and no pub row is read to answer a desk ask.
  const resolvedArea = area ? matchArea(read.venues, area) : null;
  const matched = resolvedArea
    ? read.venues.filter((venue) => venue.area === resolvedArea)
    : area
      ? []
      : read.venues;

  if (matched.length === 0) {
    const reason: FindDeskEmptyReason =
      read.status === "unavailable"
        ? "unavailable"
        : read.venues.length === 0
          ? "none-anywhere"
          : "unknown-area";
    return {
      ok: read.status === "ready",
      tool: "find_desk",
      data: { area, status: read.status, places: [] },
      provenance: read.status === "ready" ? [DIRECTORY] : [],
      cards: [],
      proposals: [],
      answerHint: findDeskEmptyLine({ area, reason }),
      ...(read.status === "unavailable" ? { degraded: true } : {}),
    };
  }

  const places = matched.slice(0, limit);
  const cards: AskCard[] = places.map((place) => ({
    key: `desk:${place.id}`,
    venueId: place.id,
    title: place.name,
    place: place.area,
    note: findDeskRowNote({ area: place.area, kind: place.kind }),
    price: null,
    provenance: DIRECTORY,
  }));

  return {
    ok: true,
    tool: "find_desk",
    data: { area, status: read.status, places },
    provenance: [DIRECTORY],
    cards,
    proposals: cards
      .slice(0, 3)
      .map((card) => openProposal(card.venueId, card.title)),
    answerHint: `${places.length} place${places.length === 1 ? "" : "s"} to sit and work${resolvedArea ? ` in ${resolvedArea}` : ""}. No seat or wifi report on any of them yet.`,
  };
}

// ---------------------------------------------------------------------------

export async function toolReportOccupancy(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venues = await loadConciergeVenues(ctx.cityId);
  const venueId = str(args.venueId);
  // A crowd report names the pub the drinker is standing in. "It's rammed in
  // Camden" names a borough, so it resolves to no pub and the answer asks
  // which one, rather than reading a report back at a pub down the road.
  const venueNameArg = str(args.venueName);
  const namesArea = venueNameArg
    ? matchArea(venues, venueNameArg) !== null
    : false;
  const venue =
    (venueId ? venues.find((v) => v.id === venueId) : null) ??
    (namesArea ? null : matchVenue(venues, venueNameArg, "strict"));

  const store = occupancyStoreState();
  const outcome = occupancyReportOutcome({
    venueId: venue?.id ?? "",
    venueName: venue?.name ?? "",
    level: args.level,
    store,
  });

  // Nothing is written here. A `proposed` outcome becomes a confirm-gated
  // proposal; the client POSTs `/api/venues/[id]/occupancy` on confirm.
  return {
    ok: outcome.status === "store-unbuilt" || outcome.status === "proposed",
    tool: "report_occupancy",
    data: { outcome, store },
    provenance: venue ? [DIRECTORY] : [],
    cards: [],
    proposals:
      outcome.status === "proposed"
        ? [
            {
              id: `occupancy:${outcome.venueId}:${outcome.level}`.slice(0, 80),
              kind: "report_occupancy" as const,
              label: `Log ${outcome.venueName} as ${OCCUPANCY_LEVEL_LABELS[outcome.level].toLowerCase()}`,
              venueId: outcome.venueId,
              level: outcome.level,
            },
          ]
        : [],
    answerHint: outcome.line,
  };
}
