// Deterministic Night OS Ask router (keyless path). Picks 1–2 allowlisted tools
// from the user query without calling a paid model.

import { detectWhatsOnIntent } from "@/lib/concierge/whatsOn";
import type { AskToolName } from "@/lib/ask/types";

export type RoutedToolCall = {
  name: AskToolName;
  args: Record<string, unknown>;
};

const CITY_STATUS_RE =
  /\b(tube|transit|delay|delays|weather|city status|how'?s london|right now in london)\b/i;
const JOURNEY_RE =
  /\b(how (do|can) i get|journey|get (me )?to|directions to|route to)\b/i;
const HERITAGE_RE =
  /\b(heritage|history|histor(?:y|ic)|listed building|when was|who built|story of|tell me about)\b/i;
const PRICE_RE =
  /\b(price|pint|how much|£|gbp|cost of a)\b/i;
const PLAN_RE =
  /\b(plan|crawl|three[- ]stop|3[- ]stop|sort (me )?a night|route for)\b/i;
const AREA_BUZZ_RE =
  /\b(buzz|what'?s (it )?like in|things to do in|average pint in)\b/i;
const OPEN_MAP_RE =
  /\b(open|show|fly to|take me to)\b/i;
// Pub Pal V0.1 wave (R-015). Each intent is narrower than the generic price or
// venue ask above it, so each is tested before the ones it would otherwise
// fall into.
// "dearest" and "best value" are deliberately absent: this tool ranks
// cheapest-first and its headline says so, so a dearest ask belongs to the
// price tools below rather than being answered backwards.
const CHEAPEST_NEAR_RE = /\b(cheapest|cheap(?:est)? pint)\b/i;
// A cheapest ask is about an AREA or about what is AROUND a pub. "at The Lamb"
// names one pub as the subject, which is the price tool's question, so the
// cheapest branch only claims an ask that carries one of these.
const NEAR_ANCHOR_RE = /\b(near|nearby|nearest|around|round|close to|closest to)\b/i;
// Every alternative names the LISTINGS question. A bare "right now" is a time
// qualifier a drinker hangs on any ask, so it is not one of them.
const TONIGHT_NOW_RE =
  /\b(on right now|on now|happening now|what'?s on now|busy right now|how busy)\b/i;
const VENUE_DRINKS_RE =
  /\b(what do they (?:pour|serve)|drinks? list|drink prices?|what'?s on tap|price of a (?:wine|cocktail|spirit))\b/i;
const FIND_DESK_RE =
  /\b(work from|sit and work|laptop|wi-?fi|desk|co-?working|somewhere to work|plug socket)\b/i;
// "it's quiet" is missing on purpose: quiet is how a drinker asks for a pub,
// so it stays with the venue search rather than becoming a reporting form.
const REPORT_OCCUPANCY_RE =
  /\b(it'?s (?:empty|full|rammed|packed|heaving)|report (?:the )?(?:crowd|occupancy)|no seats|some seats|log how busy)\b/i;

/**
 * Time and group words a drinker hangs on the end of an ask. They are not
 * part of a place name, so a `$` capture that keeps "Camden tonight" cannot
 * place Camden at all.
 */
const TRAILING_QUALIFIER_RE =
  /\s+(?:tonight|now|later|today|this evening|this afternoon|this morning|this weekend|with mates|for (?:two|a few|\d+))\s*$/i;

function stripTrailingQualifiers(phrase: string): string {
  let current = phrase.trim();
  for (;;) {
    const next = current.replace(TRAILING_QUALIFIER_RE, "").trim();
    if (next === current) return current;
    current = next;
  }
}

/** "in X" at the end of an ask: a PLACE, never a pub. */
function extractInPlace(query: string): string | null {
  const match = query.match(/\bin\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i);
  const place = match?.[1] ? stripTrailingQualifiers(match[1]) : "";
  return place || null;
}

/**
 * "near X" at the end of an ask: a CENTRE, which may be a pub or an area.
 *
 * The two are kept apart because the tools read them differently: an area word
 * the pack cannot place answers nothing rather than landing on a pub that
 * happens to share the name.
 */
function extractNearAnchorName(query: string): string | null {
  const match = query.match(
    /\b(?:near|nearby|around|round|close to|closest to)\s+([A-Za-z][A-Za-z\s'-]{1,40})$/i,
  );
  const place = match?.[1] ? stripTrailingQualifiers(match[1]) : "";
  return place || null;
}

function extractArea(query: string): string | null {
  return extractInPlace(query) ?? extractNearAnchorName(query);
}

/**
 * A short follow-up borrows the prior turn's PLACE only. The current ask's
 * own claim wins, so a pint ask after a wifi ask cannot be swallowed by
 * find_desk matching the earlier sentence.
 */
export function refineRoutedAskQuery(
  query: string,
  priorUserContent: string | null | undefined,
): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!priorUserContent || words.length === 0 || words.length > 4) return query;
  const current = routeAskDeterministically(query);
  if (current.some((call) => call.name !== "search_venues")) return query;
  const priorPlace = extractArea(priorUserContent);
  if (priorPlace) return `${query} in ${priorPlace}`;
  return `${priorUserContent} - ${query}`;
}

function stripIntentWords(query: string): string {
  return query
    .replace(HERITAGE_RE, " ")
    .replace(PRICE_RE, " ")
    .replace(OPEN_MAP_RE, " ")
    .replace(JOURNEY_RE, " ")
    .replace(PLAN_RE, " ")
    .replace(/\b(the|a|an|pub|please|tonight|for)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The venue phrase left in a V0.1 concierge ask.
 *
 * Separate from `stripIntentWords` on purpose: these intents carry their own
 * vocabulary plus the place prepositions ("near", "at", "round"), and widening
 * the shared stripper would change what the heritage, price and journey tools
 * are handed.
 */
function stripConciergeIntentWords(query: string): string {
  return stripIntentWords(query)
    .replace(CHEAPEST_NEAR_RE, " ")
    .replace(VENUE_DRINKS_RE, " ")
    .replace(FIND_DESK_RE, " ")
    .replace(REPORT_OCCUPANCY_RE, " ")
    .replace(/\b(near|in|at|round|by|here|it'?s)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A V0.1 concierge tool claiming one ask, or null when it may not.
 *
 * TWO rules govern every entry below, and they are what stop a new trigger
 * quietly taking an ask off a shipped tool.
 *
 *   1. A tool claims only when its OWN precondition holds. cheapest_pint_near
 *      needs an area or a near-style anchor; venue_drinks needs ONE named pub,
 *      never a place phrase; tonight_now is a now-question with no kind in it.
 *      A tool that cannot resolve what it needs falls through rather than
 *      answering with a guess.
 *   2. Where a more specific shipped intent matches the same words, the shipped
 *      tool keeps the ask. A named What's-On KIND is that intent: whats_on
 *      filters by it and no V0.1 tool does.
 */
type ConciergeClaim = { name: AskToolName; args: Record<string, unknown> };

function reportOccupancyClaim(text: string): ConciergeClaim | null {
  if (!REPORT_OCCUPANCY_RE.test(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  return {
    name: "report_occupancy",
    args: { level: text, ...(venueName ? { venueName } : {}) },
  };
}

function findDeskClaim(text: string): ConciergeClaim | null {
  if (!FIND_DESK_RE.test(text)) return null;
  // A pub or pint ask that happens to mention wifi is still a pub ask.
  if (PRICE_RE.test(text) || CHEAPEST_NEAR_RE.test(text) || /\bpubs?\b/i.test(text)) {
    return null;
  }
  const area = extractArea(text);
  return { name: "find_desk", args: area ? { area } : {} };
}

function tonightNowClaim(
  text: string,
  whatsOnKind: string | undefined,
): ConciergeClaim | null {
  if (!TONIGHT_NOW_RE.test(text)) return null;
  // "How busy" and "busy right now" still overlap a tube or weather ask, so
  // the city keeps those; a named kind belongs to whats_on.
  if (CITY_STATUS_RE.test(text) || whatsOnKind) return null;
  const area = extractArea(text);
  return { name: "tonight_now", args: area ? { area } : {} };
}

function venueDrinksClaim(text: string): ConciergeClaim | null {
  if (!VENUE_DRINKS_RE.test(text)) return null;
  // "drink prices in Camden" names a PLACE. This tool reads one pub, so a
  // place phrase leaves it to the tools that answer about an area.
  if (extractArea(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  if (!venueName) return null;
  return { name: "venue_drinks", args: { venueName } };
}

function cheapestNearClaim(text: string): ConciergeClaim | null {
  if (!CHEAPEST_NEAR_RE.test(text) || PLAN_RE.test(text)) return null;
  // "in Camden" is a place and only a place. "near The Lamb" is a centre, so it
  // rides the anchor slot, where a named pub still resolves.
  const place = extractInPlace(text);
  if (place) return { name: "cheapest_pint_near", args: { area: place } };
  const anchorName = extractNearAnchorName(text);
  if (anchorName) {
    return { name: "cheapest_pint_near", args: { venueName: anchorName } };
  }
  if (!NEAR_ANCHOR_RE.test(text)) return null;
  const venueName = stripConciergeIntentWords(text);
  return {
    name: "cheapest_pint_near",
    args: venueName ? { venueName } : {},
  };
}

function conciergeClaim(
  text: string,
  whatsOn: ReturnType<typeof detectWhatsOnIntent>,
): ConciergeClaim | null {
  return (
    reportOccupancyClaim(text) ??
    findDeskClaim(text) ??
    tonightNowClaim(text, whatsOn?.kind) ??
    venueDrinksClaim(text) ??
    (whatsOn ? null : cheapestNearClaim(text))
  );
}

/**
 * Choose tools for a free-text ask. Order matters: specialised intents beat the
 * default venue search. Cap at two tools so the keyless path stays snappy.
 */
export function routeAskDeterministically(query: string): RoutedToolCall[] {
  const text = query.trim();
  if (!text) return [];

  const calls: RoutedToolCall[] = [];
  const push = (name: AskToolName, args: Record<string, unknown> = {}) => {
    if (calls.some((c) => c.name === name)) return;
    if (calls.length >= 2) return;
    calls.push({ name, args });
  };

  // The V0.1 concierge intents are each NARROWER than the generic ask they
  // would otherwise fall into, so a satisfied one answers alone. One that
  // cannot meet its own precondition falls through to the tools below.
  const whatsOn = detectWhatsOnIntent(text);
  const claim = conciergeClaim(text, whatsOn);
  if (claim) {
    push(claim.name, claim.args);
    return calls;
  }

  if (whatsOn) {
    push("whats_on", { query: text });
    return calls;
  }

  if (CITY_STATUS_RE.test(text)) {
    push("city_status");
  }

  if (AREA_BUZZ_RE.test(text)) {
    const area = extractArea(text) ?? "Westminster";
    push("area_buzz", { area });
  }

  if (JOURNEY_RE.test(text)) {
    const to = stripIntentWords(text) || text;
    push("journey", { from: "London Bridge", to });
  }

  if (HERITAGE_RE.test(text)) {
    const venueName = stripIntentWords(text);
    push("venue_heritage", venueName ? { venueName, query: text } : { query: text });
  }

  if (PRICE_RE.test(text) && !PLAN_RE.test(text)) {
    const venueName = stripIntentWords(text);
    push("venue_prices", venueName ? { venueName, query: text } : { query: text });
  }

  if (PLAN_RE.test(text)) {
    push("propose_plan", { query: text });
  }

  if (OPEN_MAP_RE.test(text) && !PLAN_RE.test(text) && calls.length === 0) {
    const venueName = stripIntentWords(text);
    push("propose_map_action", venueName ? { venueName } : { query: text });
  }

  if (calls.length === 0) {
    push("search_venues", { query: text, limit: 4 });
  }

  return calls;
}
