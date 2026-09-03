// F3 / ADR 0014 — client session for Night OS Ask on the map.
// Latest-wins, timeout, curated errors. Hits POST /api/ask.

import {
  ASK_PLAN_DRAFT_STORAGE_KEY,
  type AskCard as AskApiCard,
  type AskPlanDraft,
  type AskProposal,
  type AskResponseBody,
  type AskTurn,
} from "@/lib/ask/types";

export type AskCard = {
  key: string;
  venueId: string;
  title: string;
  place: string;
  note: string;
  price: number | null;
};

export type AskResult =
  | {
      status: "answered";
      message: string;
      cards: AskCard[];
      proposals: AskProposal[];
      responseStatus: "ready" | "degraded";
    }
  | { status: "error"; message: string };

export const ASK_FALLBACK_MESSAGE = "Couldn't answer that. Try again.";

export const ASK_TIMEOUT_MS = 12_000;

type AskOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCards(raw: unknown): AskCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const record =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    return {
      key: str(record.key) || `c-${index}`,
      venueId: str(record.venueId),
      title: str(record.title) || "Result",
      place: str(record.place),
      note: str(record.note),
      price: num(record.price),
    };
  });
}

function asProposals(raw: unknown): AskProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: AskProposal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = str(record.id);
    const label = str(record.label) || "Confirm";
    if (record.kind === "open_venue" && str(record.venueId)) {
      out.push({
        id: id || `open:${record.venueId}`,
        kind: "open_venue",
        label,
        venueId: str(record.venueId),
      });
      continue;
    }
    if (
      record.kind === "draft_plan" &&
      Array.isArray(record.stopIds) &&
      typeof record.query === "string"
    ) {
      out.push({
        id: id || "draft_plan",
        kind: "draft_plan",
        label,
        query: str(record.query),
        stopIds: record.stopIds.filter((v): v is string => typeof v === "string"),
        stopNames: Array.isArray(record.stopNames)
          ? record.stopNames.filter((v): v is string => typeof v === "string")
          : [],
      });
      continue;
    }
    if (
      record.kind === "fly_to" &&
      typeof record.lat === "number" &&
      typeof record.lng === "number"
    ) {
      out.push({
        id: id || `fly:${record.lat},${record.lng}`,
        kind: "fly_to",
        label,
        lat: record.lat,
        lng: record.lng,
        ...(typeof record.place === "string" ? { place: record.place } : {}),
      });
      continue;
    }
    if (
      record.kind === "report_occupancy" &&
      str(record.venueId) &&
      (record.level === "empty" ||
        record.level === "some-seats" ||
        record.level === "full")
    ) {
      out.push({
        id: id || `occupancy:${record.venueId}:${record.level}`,
        kind: "report_occupancy",
        label,
        venueId: str(record.venueId),
        level: record.level,
      });
    }
  }
  return out;
}

/**
 * Normalise `/api/ask` (and legacy `/api/concierge`) bodies into map cards.
 */
export function answerFromBody(body: unknown): AskResult {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  // New Ask agent shape (ADR 0014).
  if (typeof record.answer === "string") {
    return {
      status: "answered",
      message: record.answer,
      cards: asCards(record.cards),
      proposals: asProposals(record.proposals),
      responseStatus: record.status === "degraded" ? "degraded" : "ready",
    };
  }

  // Legacy What's-On answer.
  if (record.mode === "whats-on") {
    const listings = Array.isArray(record.listings) ? record.listings : [];
    const cards: AskCard[] = listings.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        key: str(item.id) || `wo-${index}`,
        venueId: str(item.venueId),
        title: str(item.title) || "Listing",
        place: str(item.venue),
        note: str(item.detail),
        price: num(item.priceGbp),
      };
    });
    return {
      status: "answered",
      message: str(record.message) || "Here's what I found.",
      cards,
      proposals: [],
      responseStatus: "ready",
    };
  }

  // Legacy venue-ranking answer.
  const venues = Array.isArray(record.venues) ? record.venues : [];
  const cards: AskCard[] = venues.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(item.reasons)
      ? (item.reasons.filter((r) => typeof r === "string") as string[])
      : [];
    return {
      key: str(item.id) || `v-${index}`,
      venueId: str(item.id),
      title: str(item.name) || "Pub",
      place: str(item.area),
      note: reasons[0] ?? "",
      price: num(item.cheapestPrice),
    };
  });

  const message =
    str(record.message) ||
    (cards.length > 0
      ? `${cards.length} ${cards.length === 1 ? "pick" : "picks"} from our records, each with its source.`
      : "Nothing listed matches that. Try a nearby area or a broader ask.");

  return {
    status: "answered",
    message,
    cards,
    proposals: [],
    responseStatus: "ready",
  };
}

export function writeAskPlanDraft(draft: AskPlanDraft): void {
  try {
    sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* private mode */
  }
}

export function createAskSession(options: AskOptions = {}) {
  const timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentId = 0;
  const turns: AskTurn[] = [];

  return async function ask(
    query: string,
    cityId: string,
  ): Promise<AskResult | null> {
    const requestId = ++currentId;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: Record<string, unknown> | null;
      try {
        response = await fetchImpl("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query,
            cityId,
            turns: turns.slice(-6),
          }),
          signal: controller.signal,
        });
        const parsed: unknown = await response.json();
        body =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null;
      if (!response.ok) {
        return {
          status: "error",
          message:
            typeof body?.error === "string" ? body.error : ASK_FALLBACK_MESSAGE,
        };
      }
      const result = answerFromBody(body);
      if (result.status === "answered") {
        turns.push({ role: "user", content: query });
        turns.push({ role: "assistant", content: result.message });
        while (turns.length > 6) turns.shift();
      }
      return result;
    } catch {
      if (requestId !== currentId) return null;
      return { status: "error", message: ASK_FALLBACK_MESSAGE };
    }
  };
}

export type { AskApiCard, AskProposal, AskResponseBody, AskTurn };
