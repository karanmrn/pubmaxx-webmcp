// Pub Pal chat — pure answer shaping over the EXISTING grounded concierge
// engine (`app/api/concierge`). The /pal/chat surface is a chat SKIN: the user
// asks in natural language, the engine runs its deterministic intent parse +
// deterministic rank over our own rows (or a grounded What's-On lookup), and
// the ANSWER CARDS ARE THE FACTS — each keeping its provenance label.
//
// This module holds ONLY pure normalisation so it is unit-testable in a node
// environment (no React, no server imports, no clock). It maps either concierge
// response shape into provenance-carrying chat cards. It NEVER invents a venue,
// price, or listing: a card is only shaped from fields the engine attested, and
// a listing with no honest source label is dropped rather than shown bare.
//
// House-voice, deterministic connective copy only. No model narration runs here
// (the server `narrated` seam stays OFF until a key is funded); the client never
// requests it, so every message below is written in house, not generated.
//
// In-thread turns may be resent to `/api/ask` for refinement (ADR 0014). Durable
// Pal memory stays confirm-gated (ADR 0006) and is never written from chat.

// Which grounded source a card came from. `directory` = our own first-party
// venue index (deterministic rank); `whats-on` = a verified What's-On row that
// carries its own attributable {label, url} source.
export type PalProvenanceKind = "directory" | "whats-on";

export type PalProvenance = {
  // The chip label a reader sees. Never blank — a card is not rendered without
  // an honest provenance label.
  label: string;
  // A real, attributable link when the underlying fact carries one. What's-On
  // rows always do; first-party directory rows are on record with us and carry
  // a label but no external URL.
  url?: string;
  kind: PalProvenanceKind;
};

// A single grounded answer card. Mirrors only what the engine attested; adds
// nothing the underlying row did not.
export type PalCard = {
  key: string;
  // Empty string when the card is not deep-linkable to a venue.
  venueId: string;
  title: string;
  place: string;
  note: string;
  price: number | null;
  // Non-negotiable: every card keeps its provenance label.
  provenance: PalProvenance;
  // What's-On rows carry a confidence grade; directory rows do not.
  confidence?: string;
  // What's-On start time (ISO-8601) for display; directory rows omit it.
  when?: string;
};

export type PalAnswer = {
  // `answered` = one or more grounded cards. `empty` = an honest refusal in
  // house empty-state voice (zero rows), never an invented filler.
  status: "answered" | "empty";
  message: string;
  cards: PalCard[];
};

// Provenance label for a first-party directory row. Matches the house
// convention already used for on-record dataset facts (see DrinkMenu ProvChip:
// a first-party dataset reads "On record").
export const DIRECTORY_PROVENANCE_LABEL = "On record";

// Curated, house-voice fallback when even the request itself fails. Reused by
// the chat session so no raw JS error text ever reaches the UI.
export const PAL_ERROR_FALLBACK = "Couldn't answer that. Try again.";

// Honest empty-state line for a grounded venue ask with zero matches. No
// apology slop, no invented venues — a plain "nothing sourced" and a next step.
export const PAL_EMPTY_MESSAGE =
  "Nothing sourced for that. Try a nearby area or a broader ask.";

// Web-search grounding seam (PRD Lane C / owner decision 3). Live web grounding
// (Exa/Firecrawl at query time, answers clearly marked as web-sourced) is a
// FUTURE, second flag, held OFF until a durable spend limiter is proven. This is
// a stub seam ONLY: there is deliberately no code path in the /pal/chat surface
// that can reach the network for grounding. Kept as a named constant so the
// "OFF" posture is explicit and guarded by a test.
export const PAL_WEB_GROUNDING = false as const;

/**
 * Deterministic Europe/London display of a What's-On start time. Pure: the same
 * ISO always formats the same string regardless of the host clock or timezone,
 * so it is safe for hermetic tests. Returns "" for an unparseable instant.
 */
export function formatPalWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

// Shape a verified What's-On listing into a card, preserving its attributable
// source. A listing with no honest source label is dropped (provenance is
// non-negotiable) rather than shown unattributed.
function whatsOnCard(raw: unknown, index: number): PalCard | null {
  const item = isRecord(raw) ? raw : {};
  const source = isRecord(item.source) ? item.source : {};
  const label = str(source.label);
  if (!label) return null;
  const url = str(source.url);
  const card: PalCard = {
    key: str(item.id) || `wo-${index}`,
    venueId: str(item.venueId),
    title: str(item.title) || "Listing",
    place: str(item.venue),
    note: str(item.detail),
    price: num(item.priceGbp),
    provenance: { label, kind: "whats-on", ...(url ? { url } : {}) },
  };
  const confidence = str(item.confidence);
  if (confidence) card.confidence = confidence;
  const when = str(item.startsAt);
  if (when) card.when = when;
  return card;
}

// Shape a deterministically-ranked venue into a card. These are first-party
// rows from our own directory, so their provenance is "On record"; the leading
// grounded reason (e.g. "In Soho", "£4.50 is within budget") becomes the note.
function venueCard(raw: unknown, index: number): PalCard | null {
  const item = isRecord(raw) ? raw : {};
  const name = str(item.name);
  if (!name) return null;
  const id = str(item.id);
  const reasons = Array.isArray(item.reasons)
    ? item.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  return {
    key: id || `v-${index}`,
    venueId: id,
    title: name,
    place: str(item.area),
    note: reasons[0] ?? "",
    price: num(item.cheapestPrice),
    provenance: { label: DIRECTORY_PROVENANCE_LABEL, kind: "directory" },
  };
}

// Deterministic, house-voice connective copy for a venue answer that the engine
// did not caption itself (the happy path). The route only supplies its own
// `message` on the degraded/empty venue path; when it does, we defer to it.
function venueMessage(count: number): string {
  if (count === 0) return PAL_EMPTY_MESSAGE;
  return `${count} ${count === 1 ? "pick" : "picks"} from our records, each with its source.`;
}

/**
 * Normalise either concierge response shape into a grounded chat answer.
 *
 * Both paths stay honest: venue ranking returns first-party rows with their
 * "On record" provenance; the What's-On path returns verified listings carrying
 * their own {label, url}. The engine always supplies its own honest message for
 * refusals and the What's-On path, so we defer to `record.message` whenever it
 * is present and only synthesise house-voice copy for the venue happy path.
 */
export function palAnswerFromBody(body: unknown): PalAnswer {
  const record = isRecord(body) ? body : {};

  // What's-On answer (grounded listings, each attributable). Carries its own
  // honest message — including its own zero-row refusal.
  if (record.mode === "whats-on") {
    const listings = Array.isArray(record.listings) ? record.listings : [];
    const cards = listings.map(whatsOnCard).filter(nonNull);
    const message =
      str(record.message) ||
      (cards.length
        ? `${cards.length} ${cards.length === 1 ? "listing from a named source" : "listings from named sources"}.`
        : "No sourced listings for that yet.");
    return { status: cards.length ? "answered" : "empty", message, cards };
  }

  // Venue-ranking answer. `record.message` is present only on the degraded or
  // empty path; otherwise we caption in house voice.
  const venues = Array.isArray(record.venues) ? record.venues : [];
  const cards = venues.map(venueCard).filter(nonNull);
  const message = str(record.message) || venueMessage(cards.length);
  return { status: cards.length ? "answered" : "empty", message, cards };
}
