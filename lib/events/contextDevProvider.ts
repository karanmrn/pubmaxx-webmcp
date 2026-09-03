// The Context.dev registered-source events lane.
//
// Every specifier below is RELATIVE and carries its extension, and this module
// carries no `server-only` marker, because scripts/whatson/eventsRefresh.mjs
// imports it under plain `node`: Node strips TypeScript types but resolves no
// tsconfig `@/*` alias, and `server-only` throws on import outside a React
// Server Component. Import the transport from `@/lib/contextDev.server` in app
// code; this lane is a CLI consumer.

import {
  createContextDevBudget,
  extract,
  isContextDevConfigured,
  type ContextDevCallOptions,
} from "../contextDev.ts";
import { contextDevEventSources, type HarvestSource } from "../harvest/sourcePolicy.ts";
import {
  DATE_ONLY_TIME_EVIDENCE,
  emptyEventDrops,
  mergeEventDrops,
  statedCalendarDate,
  toIsoInstant,
  type EventDropCounts,
  type EventDropReason,
} from "../whatson/eventNormalise.mjs";

export const CONTEXT_DEV_EVENTS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const ALLOWED_KINDS = new Set(["music", "sport", "event"]);

export const CONTEXT_DEV_EVENT_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          startsAt: {
            type: "string",
            description: "ISO 8601 instant with timezone when the page states a clock time.",
          },
          startsDate: {
            type: "string",
            description: "YYYY-MM-DD when the page states a day and no clock time.",
          },
          placeName: { type: "string" },
          kind: { type: "string", enum: ["music", "sport", "event"] },
          sourceUrl: { type: "string" },
          priceText: { type: "string", description: "Ticket price text exactly as listed, if any." },
          sourceId: { type: "string", description: "Stable id from the page when one is stated." },
        },
        required: ["title", "placeName", "kind", "sourceUrl"],
      },
    },
  },
  required: ["events"],
} as const;

type RawContextDevEvent = {
  title?: unknown;
  startsAt?: unknown;
  startsDate?: unknown;
  placeName?: unknown;
  kind?: unknown;
  sourceUrl?: unknown;
  priceText?: unknown;
  sourceId?: unknown;
};

type ExtractPayload = {
  events?: RawContextDevEvent[];
};

export type ContextDevNormaliseOpts = {
  observedAt: string;
  venueIndex?: unknown;
  resolveVenue?: (venueIndex: unknown, placeName: string, lat: number | null, lng: number | null) => string | null;
};

export type ContextDevRowDrop = EventDropReason;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function httpUrl(value: unknown): string | null {
  if (!nonEmptyString(value)) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

function stableId(prefix: string, input: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function parseGbpFromText(value: unknown): number | null {
  if (!nonEmptyString(value)) return null;
  const match = /£\s*(\d+(?:\.\d{1,2})?)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourceCredit(source: HarvestSource, rowUrl: string | null): { label: string; url: string } {
  return {
    label: source.label,
    url: rowUrl ?? source.url,
  };
}

export function normaliseContextDevEventRow(
  raw: RawContextDevEvent,
  source: HarvestSource,
  opts: ContextDevNormaliseOpts,
): { row: Record<string, unknown> | null; drop?: ContextDevRowDrop } {
  if (!raw || typeof raw !== "object") return { row: null, drop: "noTitle" };

  const kind = nonEmptyString(raw.kind) ? raw.kind.trim() : "";
  if (!ALLOWED_KINDS.has(kind)) return { row: null, drop: "noKind" };

  const placeName = nonEmptyString(raw.placeName) ? raw.placeName.trim() : null;
  if (!placeName) return { row: null, drop: "noPlace" };

  const title = nonEmptyString(raw.title) ? raw.title.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  const sourceUrl = httpUrl(raw.sourceUrl);
  if (!sourceUrl) return { row: null, drop: "noUrl" };

  const startsAt = nonEmptyString(raw.startsAt) ? toIsoInstant(raw.startsAt) : null;
  const startsDate =
    startsAt === null && nonEmptyString(raw.startsDate) ? statedCalendarDate(raw.startsDate) : null;
  if (!startsAt && !startsDate) return { row: null, drop: "noStart" };

  const statedSourceId = nonEmptyString(raw.sourceId) ? raw.sourceId.trim() : null;
  const id = stableId(
    "events-cd",
    `${source.id}|${statedSourceId ?? title}|${placeName}|${startsAt ?? startsDate}`,
  );
  const row: Record<string, unknown> = {
    id,
    placeName,
    kind,
    title,
    source: sourceCredit(source, sourceUrl),
    observedAt: opts.observedAt,
    confidence: "listed",
  };

  if (startsAt) row.startsAt = startsAt;
  else {
    row.startsDate = startsDate;
    row.timeEvidence = DATE_ONLY_TIME_EVIDENCE;
  }

  // A pub's own what's-on page rarely numbers its events, and a row with no
  // `sourceId` carries no `eventIdentityKey`, so the shared
  // `dedupeEventRowsBySourceId` waves it through untouched - a page listing one
  // event twice would publish two identical cards under one React key. The
  // row's own deterministic id is the identity when the publisher states none.
  // ONE predicate decides "did the publisher state an id", above and here: an
  // empty string answered YES to a bare `??` in the hash input and NO here, so
  // the title left the hash and two real listings collapsed into one.
  row.sourceId = statedSourceId ?? id;

  const priceGbp = parseGbpFromText(raw.priceText);
  if (priceGbp !== null) row.priceGbp = priceGbp;

  if (opts.resolveVenue && opts.venueIndex) {
    const venueId = opts.resolveVenue(opts.venueIndex, placeName, null, null);
    if (venueId) row.venueId = venueId;
  }

  return { row };
}

export function normaliseContextDevExtract(
  payload: ExtractPayload,
  source: HarvestSource,
  opts: ContextDevNormaliseOpts,
): { rows: Record<string, unknown>[]; dropped: EventDropCounts } {
  const dropped = emptyEventDrops();
  const rows: Record<string, unknown>[] = [];
  const events = Array.isArray(payload?.events) ? payload.events : [];

  for (const event of events) {
    const { row, drop } = normaliseContextDevEventRow(event, source, opts);
    if (row) rows.push(row);
    else if (drop) {
      dropped[drop] += 1;
      dropped.total += 1;
    }
  }

  return { rows, dropped };
}

export function contextDevLaneStatus(env: NodeJS.ProcessEnv = process.env): "configured" | "not-configured" {
  return isContextDevConfigured(env) ? "configured" : "not-configured";
}

// Rows this lane writes carry the SOURCE's own credit label, never "Context.dev",
// so a caller carrying held rows across a lane-level failure has to ask for these
// labels rather than naming the lane.
export function contextDevSourceLabels(): string[] {
  return Array.from(new Set(contextDevEventSources().map((source) => source.label)));
}

export type ContextDevLaneFailure = {
  sourceId: string;
  label: string;
  message: string;
};

export type ContextDevLaneResult = {
  status: "not-configured" | "ran" | "failed";
  rows: Record<string, unknown>[];
  dropped: EventDropCounts;
  failures: ContextDevLaneFailure[];
  sourcesRun: Array<{ sourceId: string; label: string; rows: number }>;
};

export async function runContextDevEventsLane({
  observedAt,
  venueIndex = null,
  resolveVenue = null,
  env = process.env,
  callOptions = {},
  log = console.log,
  logError = console.error,
}: {
  observedAt: string;
  venueIndex?: unknown;
  resolveVenue?: ContextDevNormaliseOpts["resolveVenue"] | null;
  env?: NodeJS.ProcessEnv;
  callOptions?: ContextDevCallOptions;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): Promise<ContextDevLaneResult> {
  const empty = {
    status: "not-configured" as const,
    rows: [],
    dropped: emptyEventDrops(),
    failures: [],
    sourcesRun: [],
  };

  if (!isContextDevConfigured(env)) {
    log("eventsRefresh: Context.dev lane not-configured (no CONTEXT_DEV_API_KEY).");
    return empty;
  }

  const sources = contextDevEventSources();
  if (sources.length === 0) {
    log("eventsRefresh: Context.dev lane has no allowed registered venue-events pages.");
    return { ...empty, status: "ran" };
  }

  // ONE budget for the whole lane, shared by every source and counting retries,
  // so the ceiling is what this run may put on the account rather than how many
  // pages it covers. A caller may hand its own in through callOptions.
  const budget = callOptions.budget ?? createContextDevBudget();
  const opts: ContextDevNormaliseOpts = { observedAt, venueIndex, resolveVenue: resolveVenue ?? undefined };
  const allRows: Record<string, unknown>[] = [];
  const dropped = emptyEventDrops();
  const failures: ContextDevLaneFailure[] = [];
  const sourcesRun: Array<{ sourceId: string; label: string; rows: number }> = [];

  for (const source of sources) {
    const result = await extract<ExtractPayload>(
      source.url,
      CONTEXT_DEV_EVENT_EXTRACT_SCHEMA,
      {
        ...callOptions,
        env,
        budget,
        maxAgeMs: callOptions.maxAgeMs ?? CONTEXT_DEV_EVENTS_MAX_AGE_MS,
        instructions:
          "Extract upcoming pub and bar events only. Do not invent start times. " +
          "Use startsDate when the page states a day without a clock time.",
      },
    );

    if (result.status === "not-configured") {
      logError(
        "eventsRefresh: Context.dev lane became not-configured mid-run - " +
          "every source still to be asked is recorded as unread.",
      );
      for (const unread of sources.slice(sources.indexOf(source))) {
        failures.push({
          sourceId: unread.id,
          label: unread.label,
          message: "Context.dev key went absent mid-run.",
        });
      }
      break;
    }

    if (result.status === "error") {
      logError(
        `eventsRefresh: Context.dev extract failed for ${source.label} (${result.error.code}: ${result.error.message}) - held rows carry across.`,
      );
      failures.push({
        sourceId: source.id,
        label: source.label,
        message: result.error.message,
      });
      continue;
    }

    const normalised = normaliseContextDevExtract(result.data, source, opts);
    allRows.push(...normalised.rows);
    mergeEventDrops(dropped, normalised.dropped);
    sourcesRun.push({ sourceId: source.id, label: source.label, rows: normalised.rows.length });
    log(
      `eventsRefresh: Context.dev ${source.label} -> ${normalised.rows.length} rows ` +
        `(dropped ${normalised.dropped.total})`,
    );
  }

  return {
    status: failures.length === sources.length ? "failed" : "ran",
    rows: allRows,
    dropped,
    failures,
    sourcesRun,
  };
}
