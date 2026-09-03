// Night OS Ask — shared request/response contracts (ADR 0014).
// Browser-safe types only: no server imports.

export type AskSource = {
  label: string;
  url?: string;
  kind:
    | "directory"
    | "whats-on"
    | "heritage"
    | "community-price"
    | "citymcp"
    | "plan";
};

export type AskCard = {
  key: string;
  venueId: string;
  title: string;
  place: string;
  note: string;
  price: number | null;
  provenance?: AskSource;
};

export type AskProposal =
  | {
      id: string;
      kind: "open_venue";
      label: string;
      venueId: string;
    }
  | {
      id: string;
      kind: "draft_plan";
      label: string;
      query: string;
      stopIds: string[];
      stopNames: string[];
    }
  | {
      id: string;
      kind: "fly_to";
      label: string;
      lat: number;
      lng: number;
      place?: string;
    }
  | {
      id: string;
      kind: "report_occupancy";
      label: string;
      venueId: string;
      level: "empty" | "some-seats" | "full";
    };

export type AskTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AskResponseStatus = "ready" | "degraded";

export type AskResponseBody = {
  answer: string;
  cards: AskCard[];
  proposals: AskProposal[];
  sources: AskSource[];
  status: AskResponseStatus;
  /** Tools that ran this turn (debug / tests; safe to show in UI as chips). */
  toolsUsed: string[];
};

export const ASK_TOOL_NAMES = [
  "search_venues",
  "whats_on",
  "venue_heritage",
  "venue_prices",
  "city_status",
  "journey",
  "area_buzz",
  "propose_plan",
  "propose_map_action",
  // Pub Pal V0.1 concierge wave (master plan R-015). Same laws as the rest of
  // the allowlist: grounded, provenance on every card, and nothing writes.
  "cheapest_pint_near",
  "tonight_now",
  "venue_drinks",
  "find_desk",
  "report_occupancy",
] as const;

export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export function isAskToolName(value: string): value is AskToolName {
  return (ASK_TOOL_NAMES as readonly string[]).includes(value);
}

/** Session draft written when the user confirms a draft_plan proposal. */
export const ASK_PLAN_DRAFT_STORAGE_KEY = "pubmax:ask-plan-draft:v1";

export type AskPlanDraft = {
  query: string;
  stopIds: string[];
  stopNames: string[];
  createdAt: string;
};
