// Pub Pal chat — client ask session over Night OS Ask (`/api/ask`).
// Latest-wins, timeout, curated errors. In-thread turns only (ADR 0014);
// durable Pal memory stays confirm-gated (ADR 0006). Never sends `narrated`.

import {
  DIRECTORY_PROVENANCE_LABEL,
  PAL_ERROR_FALLBACK,
  palAnswerFromBody,
  type PalAnswer,
  type PalCard,
} from "@/lib/palChat";
import type { AskProposal, AskTurn } from "@/lib/ask/types";
import { answerFromBody } from "@/lib/conciergeAskClient";

export type PalChatResult =
  | (PalAnswer & { proposals: AskProposal[] })
  | { status: "error"; message: string };

export const PAL_CHAT_TIMEOUT_MS = 12_000;

type SessionOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function askBodyToPal(body: unknown): PalChatResult {
  // Prefer the Ask agent shape when present.
  const ask = answerFromBody(body);
  if (ask.status === "error") return ask;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).answer === "string"
  ) {
    const record = body as Record<string, unknown>;
    const rawCards = Array.isArray(record.cards) ? record.cards : [];
    const cards: PalCard[] = [];
    for (const [index, raw] of rawCards.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const provenanceRaw =
        item.provenance && typeof item.provenance === "object"
          ? (item.provenance as Record<string, unknown>)
          : null;
      const label =
        typeof provenanceRaw?.label === "string" && provenanceRaw.label.trim()
          ? provenanceRaw.label.trim()
          : DIRECTORY_PROVENANCE_LABEL;
      const kind =
        provenanceRaw?.kind === "whats-on" ? "whats-on" : "directory";
      cards.push({
        key:
          typeof item.key === "string" && item.key
            ? item.key
            : `ask-${index}`,
        venueId: typeof item.venueId === "string" ? item.venueId : "",
        title: typeof item.title === "string" ? item.title : "Result",
        place: typeof item.place === "string" ? item.place : "",
        note: typeof item.note === "string" ? item.note : "",
        price:
          typeof item.price === "number" && Number.isFinite(item.price)
            ? item.price
            : null,
        provenance: {
          label,
          kind,
          ...(typeof provenanceRaw?.url === "string"
            ? { url: provenanceRaw.url }
            : {}),
        },
      });
    }
    return {
      status: cards.length > 0 ? "answered" : "empty",
      message: ask.message,
      cards,
      proposals: ask.proposals,
    };
  }

  // Legacy concierge body.
  const legacy = palAnswerFromBody(body);
  return { ...legacy, proposals: [] };
}

/**
 * Create a chat ask session with latest-wins ordering and in-thread memory.
 */
export function createPalChatSession(options: SessionOptions = {}) {
  const timeoutMs = options.timeoutMs ?? PAL_CHAT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentId = 0;
  const turns: AskTurn[] = [];

  return async function ask(
    query: string,
    cityId: string,
  ): Promise<PalChatResult | null> {
    const requestId = ++currentId;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: unknown;
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
        body = await response.json();
      } finally {
        clearTimeout(timeoutId);
      }
      if (requestId !== currentId) return null;
      if (!response.ok) {
        const record =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        return {
          status: "error",
          message:
            typeof record.error === "string" ? record.error : PAL_ERROR_FALLBACK,
        };
      }
      const result = askBodyToPal(body);
      if (result.status !== "error") {
        turns.push({ role: "user", content: query });
        turns.push({ role: "assistant", content: result.message });
        while (turns.length > 6) turns.shift();
      }
      return result;
    } catch {
      if (requestId !== currentId) return null;
      return { status: "error", message: PAL_ERROR_FALLBACK };
    }
  };
}
