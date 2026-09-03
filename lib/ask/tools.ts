// Night OS Ask tool registry (ADR 0014). Server-only handlers with typed I/O
// and provenance. No tool invents a price.

import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import {
  drivesMap,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { readCommunityPricesWithStatus } from "@/lib/communityPriceStore";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import {
  rankConciergeVenues,
  type ConciergeVenue,
} from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  buildWhatsOnAnswer,
  detectWhatsOnIntent,
  filterRowsByArea,
  filterRowsByWeekday,
} from "@/lib/concierge/whatsOn";
import {
  CityMcpError,
  fetchCityStatus,
  fetchJourney,
  fetchThingsToDo,
  formatJourneyPoint,
} from "@/lib/citymcp/client";
import { fetchCityArea } from "@/lib/citymcp/area";
import { retrieveHeritage } from "@/lib/heritage";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import {
  isAskToolName,
  type AskCard,
  type AskProposal,
  type AskToolName,
} from "@/lib/ask/types";
import { CONCIERGE_TOOL_DEFINITIONS } from "@/lib/ask/conciergeTools";
import {
  toolCheapestPintNear,
  toolFindDesk,
  toolReportOccupancy,
  toolTonightNow,
  toolVenueDrinks,
} from "@/lib/ask/conciergeTools.server";
import type {
  AskProvenance,
  AskToolArgs,
  AskToolContext,
  AskToolResult,
} from "@/lib/ask/toolContract";

export type {
  AskProvenance,
  AskToolArgs,
  AskToolContext,
  AskToolResult,
} from "@/lib/ask/toolContract";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function proposalId(prefix: string, seed: string): string {
  return `${prefix}:${seed}`.slice(0, 80);
}

function directoryProvenance(): AskProvenance {
  return { label: "On record", kind: "directory" };
}

function matchVenueByName(
  venues: ConciergeVenue[],
  name: string,
): ConciergeVenue | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = venues.find((v) => v.name.toLowerCase() === needle);
  if (exact) return exact;
  const starts = venues.find((v) => v.name.toLowerCase().startsWith(needle));
  if (starts) return starts;
  return venues.find((v) => v.name.toLowerCase().includes(needle)) ?? null;
}

function venueCard(
  venue: ConciergeVenue,
  note: string,
  key?: string,
): AskCard {
  return {
    key: key ?? venue.id,
    venueId: venue.id,
    title: venue.name,
    place: venue.area,
    note,
    price: venue.cheapestPrice,
    provenance: directoryProvenance(),
  };
}

async function toolSearchVenues(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const limitRaw = typeof args.limit === "number" ? args.limit : 4;
  const limit = Math.min(6, Math.max(1, Math.floor(limitRaw)));
  const query = str(args.query) || ctx.query;
  try {
    const parsed = await parseConciergeIntent(query, {
      skipModel: ctx.skipModel !== false,
    });
    const venues = await loadConciergeVenues(ctx.cityId);
    const ranked = rankConciergeVenues(venues, parsed.intent, { limit });
    const cards = ranked.map(({ venue, reasons }) =>
      venueCard(venue, reasons[0] ?? "", venue.id),
    );
    const proposals: AskProposal[] = cards
      .filter((c) => c.venueId)
      .slice(0, 3)
      .map((c) => ({
        id: proposalId("open", c.venueId),
        kind: "open_venue" as const,
        label: `Open ${c.title}`,
        venueId: c.venueId,
      }));
    return {
      ok: true,
      tool: "search_venues",
      data: {
        intent: parsed.intent,
        intentSource: parsed.source,
        venues: ranked.map(({ venue, score, reasons }) => ({
          id: venue.id,
          name: venue.name,
          area: venue.area,
          lat: venue.lat,
          lng: venue.lng,
          cheapestPrice: venue.cheapestPrice,
          score,
          reasons,
        })),
      },
      provenance: [directoryProvenance()],
      cards,
      proposals,
      answerHint:
        cards.length > 0
          ? ""
          : "Nothing listed matches that. Try a nearby area or a broader mood.",
    };
  } catch {
    return {
      ok: false,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "I couldn't load listed venue options.",
      degraded: true,
    };
  }
}

async function toolWhatsOn(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const query = str(args.query) || ctx.query;
  const detected = detectWhatsOnIntent(query);
  if (!detected) {
    return {
      ok: false,
      tool: "whats_on",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint:
        "Ask about quiz nights, live music, sport or deals and I'll check the listings.",
    };
  }
  const unavailable = (): AskToolResult => ({
    ok: false,
    tool: "whats_on",
    data: null,
    provenance: [],
    cards: [],
    proposals: [],
    answerHint: "I couldn't load sourced listings just now.",
    degraded: true,
  });
  try {
    const { rows, asOf, readStatus } = await loadWhatsOn(
      {
        ...(detected.kind ? { kind: detected.kind } : {}),
        ...(detected.window === "tonight" ? { window: "tonight" as const } : {}),
      },
      {},
    );
    // A bundled read that could not run answers nothing. Refusing honestly is
    // the whole contract here; "no matches" would be an invented empty market.
    if (readStatus === "degraded") return unavailable();
    let matched = detected.area ? filterRowsByArea(rows, detected.area) : rows;
    if (detected.window === "weekday" && detected.weekday !== undefined) {
      matched = filterRowsByWeekday(matched, detected.weekday);
    }
    const answer = buildWhatsOnAnswer(detected, matched);
    const cards: AskCard[] = answer.listings.map((item, index) => ({
      key: item.id || `wo-${index}`,
      venueId: item.venueId ?? "",
      title: item.title,
      place: item.venue ?? "",
      note: item.detail ?? "",
      price: typeof item.priceGbp === "number" ? item.priceGbp : null,
      provenance: {
        label: item.source?.label || "What's On",
        ...(item.source?.url ? { url: item.source.url } : {}),
        kind: "whats-on",
      },
    }));
    const proposals: AskProposal[] = cards
      .filter((c) => c.venueId)
      .slice(0, 3)
      .map((c) => ({
        id: proposalId("open", c.venueId),
        kind: "open_venue" as const,
        label: `Open ${c.title}`,
        venueId: c.venueId,
      }));
    return {
      ok: true,
      tool: "whats_on",
      data: { ...answer, asOf },
      provenance: cards
        .map((c) => c.provenance)
        .filter((p): p is AskProvenance => Boolean(p)),
      cards,
      proposals,
      answerHint: answer.message,
    };
  } catch {
    return unavailable();
  }
}

async function toolVenueHeritage(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venueName = str(args.venueName) || str(args.name);
  const venueId = str(args.venueId);
  let name = venueName;
  let id = venueId;
  if (!name) {
    const venues = await loadConciergeVenues(ctx.cityId);
    const hit =
      (id ? venues.find((v) => v.id === id) : null) ??
      matchVenueByName(venues, ctx.query.replace(/\?+$/, ""));
    if (hit) {
      name = hit.name;
      id = hit.id;
    }
  }
  if (!name) {
    return {
      ok: false,
      tool: "venue_heritage",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "Name a listed pub to ask about its story.",
    };
  }
  const facts = await retrieveHeritage({
    ...(id ? { venueId: id } : {}),
    venueName: name,
  });
  const provenance: AskProvenance[] = facts.map((f) => ({
    label: f.source.toUpperCase(),
    ...(f.sourceRef ? { url: f.sourceRef } : {}),
    kind: "heritage" as const,
  }));
  const note = facts.length
    ? facts
        .slice(0, 3)
        .map((f) => f.fact)
        .join(" ")
    : "I've got the basics but no fuller story on record yet. I won't make one up.";
  const cards: AskCard[] = [
    {
      key: id || name,
      venueId: id,
      title: name,
      place: "",
      note,
      price: null,
      provenance: provenance[0] ?? { label: "Heritage", kind: "heritage" },
    },
  ];
  const proposals: AskProposal[] = id
    ? [
        {
          id: proposalId("open", id),
          kind: "open_venue",
          label: `Open ${name}`,
          venueId: id,
        },
      ]
    : [];
  return {
    ok: true,
    tool: "venue_heritage",
    data: { venueId: id || null, venueName: name, facts },
    provenance,
    cards,
    proposals,
    answerHint: facts.length
      ? `On record for ${name}: ${facts.length} fact${facts.length === 1 ? "" : "s"}.`
      : note,
  };
}

function communityPriceNote(price: CommunityPrice): string {
  const when = Number.isFinite(price.submittedAt)
    ? new Date(price.submittedAt).toISOString().slice(0, 10)
    : "undated";
  return `${price.drinkCategory} · people-logged ${when}`;
}

async function toolVenuePrices(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venueIdArg = str(args.venueId);
  const venueName = str(args.venueName) || str(args.name);
  const venues = await loadConciergeVenues(ctx.cityId);
  const venue =
    (venueIdArg ? venues.find((v) => v.id === venueIdArg) : null) ??
    (venueName ? matchVenueByName(venues, venueName) : null) ??
    matchVenueByName(venues, ctx.query);

  if (!venue) {
    return {
      ok: false,
      tool: "venue_prices",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "Name a listed pub to check a price.",
    };
  }

  const curatedCard = venueCard(
    venue,
    venue.cheapestPrice != null
      ? "Current recorded pint on the listed index."
      : "No current recorded pint on the listed index.",
    `${venue.id}:curated`,
  );

  const communityRead = await readCommunityPricesWithStatus(venue.id);
  const trusted = communityRead.prices.filter((p) => drivesMap(p));
  const communityCards: AskCard[] = trusted.map((p, index) => ({
    key: `${venue.id}:c-${index}`,
    venueId: venue.id,
    title: venue.name,
    place: venue.area,
    note: communityPriceNote(p),
    price: p.priceGbp,
    provenance: {
      label: "People-logged",
      kind: "community-price",
    },
  }));

  const cards = [...communityCards, curatedCard];
  const provenance: AskProvenance[] = [
    directoryProvenance(),
    ...communityCards
      .map((c) => c.provenance)
      .filter((p): p is AskProvenance => Boolean(p)),
  ];
  const proposals: AskProposal[] = [
    {
      id: proposalId("open", venue.id),
      kind: "open_venue",
      label: `Open ${venue.name}`,
      venueId: venue.id,
    },
  ];

  const answerHint =
    trusted.length > 0
      ? `${venue.name}: ${trusted.length} corroborated people-logged figure${trusted.length === 1 ? "" : "s"} plus the listed index.`
      : venue.cheapestPrice != null
        ? `${venue.name}: listed pint £${venue.cheapestPrice.toFixed(2)} (no corroborated people-logged figure yet).`
        : `${venue.name}: no corroborated people-logged pint and no listed figure.`;

  return {
    ok: true,
    tool: "venue_prices",
    data: {
      venueId: venue.id,
      curatedPrice: venue.cheapestPrice,
      communityDegraded: communityRead.degraded,
      trustedCommunity: trusted.map((p) => ({
        drinkCategory: p.drinkCategory,
        priceGbp: p.priceGbp,
        submittedAt: p.submittedAt,
        corroborations: p.corroborations,
      })),
    },
    provenance,
    cards,
    proposals,
    answerHint,
    degraded: communityRead.degraded,
  };
}

async function toolCityStatus(
  _args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  try {
    const status = await fetchCityStatus(
      {},
      ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {},
    );
    const tubeBits = (status.tubeLines ?? [])
      .slice(0, 4)
      .map((line) => `${line.line}: ${line.status}`)
      .join("; ");
    const weather = status.weather
      ? `${status.weather.condition ?? "Weather"}${
          typeof status.weather.tempC === "number"
            ? ` ${status.weather.tempC}°C`
            : ""
        }`
      : "";
    const signalBits = status.signals
      .slice(0, 3)
      .map((s) => s.headline || s.detail || "")
      .filter(Boolean)
      .join("; ");
    const note = [weather, tubeBits, signalBits].filter(Boolean).join(" · ");
    const cards: AskCard[] = [
      {
        key: "city-status",
        venueId: "",
        title: "London right now",
        // No place line: the source rides the provenance chip, and "CityMCP"
        // here read as a place name a reader could go to.
        place: "",
        note: note || "No tube or weather notes right now.",
        price: null,
        provenance: { label: "CityMCP London", kind: "citymcp" },
      },
    ];
    return {
      ok: true,
      tool: "city_status",
      data: status,
      provenance: [{ label: "CityMCP London", kind: "citymcp" }],
      cards,
      proposals: [],
      answerHint: note
        ? `London right now: ${note}`
        : "London right now: no tube or weather notes.",
      degraded: status.stale === true,
    };
  } catch (error) {
    const message =
      error instanceof CityMcpError
        ? "City status is unavailable just now."
        : "City status is unavailable just now.";
    return {
      ok: false,
      tool: "city_status",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: message,
      degraded: true,
    };
  }
}

async function toolJourney(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const from = str(args.from);
  const to = str(args.to);
  const venues = await loadConciergeVenues(ctx.cityId);
  const fromVenue = from ? matchVenueByName(venues, from) : null;
  const toVenue =
    (to ? matchVenueByName(venues, to) : null) ??
    (!to ? matchVenueByName(venues, stripForMatch(ctx.query)) : null);

  if (!from && !fromVenue) {
    return {
      ok: false,
      tool: "journey",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint:
        "Say where from and which listed pub to head to (or lat,lng points).",
    };
  }
  if (!to && !toVenue) {
    return {
      ok: false,
      tool: "journey",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "Name a listed pub (or point) to journey to.",
    };
  }

  const fromPoint = fromVenue
    ? formatJourneyPoint(fromVenue.lat, fromVenue.lng)
    : from;
  const toPoint = toVenue
    ? formatJourneyPoint(toVenue.lat, toVenue.lng)
    : to;

  try {
    const result = await fetchJourney(
      { from: fromPoint, to: toPoint },
      ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {},
    );
    const cards: AskCard[] = result.journeys.slice(0, 3).map((j, index) => ({
      key: `journey-${index}`,
      venueId: toVenue?.id ?? "",
      title: `Journey ${index + 1}`,
      place: toVenue?.name ?? to,
      note: [
        `${j.durationMinutes} min`,
        j.arrivalTime ? `arrive ${j.arrivalTime}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      price: null,
      provenance: { label: "CityMCP journey", kind: "citymcp" },
    }));
    const proposals: AskProposal[] = toVenue
      ? [
          {
            id: proposalId("open", toVenue.id),
            kind: "open_venue",
            label: `Open ${toVenue.name}`,
            venueId: toVenue.id,
          },
        ]
      : [];
    return {
      ok: true,
      tool: "journey",
      data: result,
      provenance: [{ label: "CityMCP journey", kind: "citymcp" }],
      cards,
      proposals,
      answerHint:
        cards.length > 0
          ? `Found ${cards.length} journey option${cards.length === 1 ? "" : "s"}.`
          : "No journey options came back for that pair.",
    };
  } catch {
    return {
      ok: false,
      tool: "journey",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "I couldn't load a journey just now.",
      degraded: true,
    };
  }
}

function stripForMatch(query: string): string {
  return query
    .replace(
      /\b(how (do|can) i get|journey|get (me )?to|directions to|route to|from|to)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function toolAreaBuzz(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const area = str(args.area) || str(args.borough) || "Westminster";
  const provenance: AskProvenance[] = [
    { label: "CityMCP London", kind: "citymcp" },
  ];
  let degraded = false;
  let pintLine = "";
  let thingsLine = "";
  let areaData: unknown = null;
  let thingsData: unknown = null;

  try {
    const cityArea = await fetchCityArea(
      area,
      ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {},
    );
    areaData = cityArea;
    // The reader's sentence carries no service name: the source rides the
    // card's own provenance chip, never the prose.
    pintLine =
      cityArea.averagePintGbp != null
        ? `${cityArea.borough} average pint about £${cityArea.averagePintGbp.toFixed(2)}.`
        : `No average pint figure for ${cityArea.borough} just now.`;
  } catch {
    degraded = true;
    pintLine = `Couldn't check the average pint for ${area} just now.`;
  }

  try {
    const things = await fetchThingsToDo({
      window: "tonight",
      area,
      limit: 4,
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    });
    thingsData = things;
    const rows = things.opportunities ?? [];
    thingsLine =
      rows.length > 0
        ? `${rows.length} thing${rows.length === 1 ? "" : "s"} to do listed tonight.`
        : `Nothing listed to do round ${area} tonight.`;
    if (things.stale) degraded = true;
  } catch {
    degraded = true;
    thingsLine = "Things to do are unavailable just now.";
  }

  const cards: AskCard[] = [
    {
      key: `area-${area}`,
      venueId: "",
      title: area,
      place: "London",
      note: [pintLine, thingsLine].filter(Boolean).join(" "),
      price: null,
      provenance: provenance[0],
    },
  ];

  return {
    ok: !degraded || Boolean(areaData || thingsData),
    tool: "area_buzz",
    data: { area, areaData, thingsData },
    provenance,
    cards,
    proposals: [],
    answerHint: cards[0]?.note || pintLine,
    degraded,
  };
}

async function toolProposePlan(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const query = str(args.query) || ctx.query;
  try {
    const parsed = await parseConciergeIntent(query, {
      skipModel: ctx.skipModel !== false,
    });
    const venues = await loadConciergeVenues(ctx.cityId);
    const ranked = rankConciergeVenues(venues, parsed.intent, { limit: 3 });
    if (ranked.length < 3) {
      return {
        ok: false,
        tool: "propose_plan",
        data: { intent: parsed.intent },
        provenance: [directoryProvenance()],
        cards: ranked.map(({ venue, reasons }) =>
          venueCard(venue, reasons[0] ?? ""),
        ),
        proposals: [],
        answerHint:
          "No three-stop route meets that ask with the information available.",
      };
    }
    const cards = ranked.map(({ venue, reasons }, index) =>
      venueCard(venue, `Stop ${index + 1}: ${reasons[0] ?? "Listed pick"}`),
    );
    const stopIds = cards.map((c) => c.venueId);
    const stopNames = cards.map((c) => c.title);
    const proposal: AskProposal = {
      id: proposalId("plan", stopIds.join("-")),
      kind: "draft_plan",
      label: "Open in Plan",
      query,
      stopIds,
      stopNames,
    };
    const openProposals: AskProposal[] = cards.map((c) => ({
      id: proposalId("open", c.venueId),
      kind: "open_venue" as const,
      label: `Open ${c.title}`,
      venueId: c.venueId,
    }));
    return {
      ok: true,
      tool: "propose_plan",
      data: {
        intent: parsed.intent,
        stops: ranked.map(({ venue }) => ({
          id: venue.id,
          name: venue.name,
          area: venue.area,
          lat: venue.lat,
          lng: venue.lng,
          cheapestPrice: venue.cheapestPrice,
        })),
      },
      provenance: [{ label: "On record", kind: "plan" }],
      cards,
      proposals: [proposal, ...openProposals],
      answerHint: `Proposed draft: ${stopNames.join(" → ")}. Open in Plan to carry this ask over - nothing is saved until you do.`,
    };
  } catch {
    return {
      ok: false,
      tool: "propose_plan",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "I couldn't draft a plan from the listed pubs.",
      degraded: true,
    };
  }
}

async function toolProposeMapAction(
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const venueId = str(args.venueId);
  const venues = await loadConciergeVenues(ctx.cityId);
  const venue =
    (venueId ? venues.find((v) => v.id === venueId) : null) ??
    matchVenueByName(venues, str(args.venueName) || ctx.query);

  if (venue) {
    const proposals: AskProposal[] = [
      {
        id: proposalId("open", venue.id),
        kind: "open_venue",
        label: `Open ${venue.name}`,
        venueId: venue.id,
      },
      {
        id: proposalId("fly", venue.id),
        kind: "fly_to",
        label: `Fly to ${venue.name}`,
        lat: venue.lat,
        lng: venue.lng,
        place: venue.name,
      },
    ];
    return {
      ok: true,
      tool: "propose_map_action",
      data: { venueId: venue.id, lat: venue.lat, lng: venue.lng },
      provenance: [directoryProvenance()],
      cards: [venueCard(venue, "Confirm to open or fly on the map.")],
      proposals,
      answerHint: `Ready to open ${venue.name} on the map when you confirm.`,
    };
  }

  const lat = num(args.lat);
  const lng = num(args.lng);
  if (lat != null && lng != null) {
    const place = str(args.place) || "That spot";
    return {
      ok: true,
      tool: "propose_map_action",
      data: { lat, lng, place },
      provenance: [],
      cards: [],
      proposals: [
        {
          id: proposalId("fly", `${lat},${lng}`),
          kind: "fly_to",
          label: `Fly to ${place}`,
          lat,
          lng,
          place,
        },
      ],
      answerHint: `Ready to fly the map to ${place} when you confirm.`,
    };
  }

  return {
    ok: false,
    tool: "propose_map_action",
    data: null,
    provenance: [],
    cards: [],
    proposals: [],
    answerHint: "Name a listed pub (or coordinates) to propose a map move.",
  };
}

const HANDLERS: Record<
  AskToolName,
  (args: AskToolArgs, ctx: AskToolContext) => Promise<AskToolResult>
> = {
  search_venues: toolSearchVenues,
  whats_on: toolWhatsOn,
  venue_heritage: toolVenueHeritage,
  venue_prices: toolVenuePrices,
  city_status: toolCityStatus,
  journey: toolJourney,
  area_buzz: toolAreaBuzz,
  propose_plan: toolProposePlan,
  propose_map_action: toolProposeMapAction,
  // Pub Pal V0.1 concierge wave (R-015). Handlers live beside their policy in
  // lib/ask/conciergeTools*, the same delegation shape as socialCrewActor.
  cheapest_pint_near: toolCheapestPintNear,
  tonight_now: toolTonightNow,
  venue_drinks: toolVenueDrinks,
  find_desk: toolFindDesk,
  report_occupancy: toolReportOccupancy,
};

/** OpenAI/OpenRouter tool schema for the allowlisted Night OS tools. */
export function askToolDefinitions(): Array<{
  type: "function";
  function: {
    name: AskToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return [
    {
      type: "function",
      function: {
        name: "search_venues",
        description:
          "Rank listed pubs by mood, area, group size, and budget. Never invents venues.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "whats_on",
        description:
          "Look up sourced What's On listings (quiz, sport, deals) for tonight or a weekday.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "venue_heritage",
        description:
          "Retrieve on-record heritage facts for a named listed pub. Never invents history.",
        parameters: {
          type: "object",
          properties: {
            venueName: { type: "string" },
            venueId: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "venue_prices",
        description:
          "Read listed and corroborated people-logged prices for a pub. Never invents figures.",
        parameters: {
          type: "object",
          properties: {
            venueName: { type: "string" },
            venueId: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "city_status",
        description: "London live weather, tube, and city signals via CityMCP.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "journey",
        description: "Transit journey between two points or listed pubs via CityMCP.",
        parameters: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "area_buzz",
        description: "Borough pint average and things to do tonight via CityMCP.",
        parameters: {
          type: "object",
          properties: {
            area: { type: "string" },
            borough: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "propose_plan",
        description:
          "Propose a three-stop draft from listed pubs. Saves nothing: the user opens Plan with the ask through one link, and nothing is stored until they lock a route there.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "propose_map_action",
        description:
          "Propose opening a pub sheet or flying the map. User must confirm before anything moves.",
        parameters: {
          type: "object",
          properties: {
            venueId: { type: "string" },
            venueName: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            place: { type: "string" },
          },
        },
      },
    },
    ...CONCIERGE_TOOL_DEFINITIONS,
  ];
}

export async function runAskTool(
  name: string,
  args: AskToolArgs,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  if (!isAskToolName(name)) {
    return {
      ok: false,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "That tool is not available.",
    };
  }
  return HANDLERS[name](args, ctx);
}

export function resolveAskCityId(raw: unknown): CityId {
  if (typeof raw === "string") {
    const parsed = parseCityId(raw);
    if (parsed) return parsed;
  }
  return DEFAULT_CITY_ID;
}

/** Exported for deterministic router tests. */
export { matchVenueByName, detectWhatsOnIntent };
