import type { ScrapedPubSourceId } from "@/lib/scrapedPubs";
import { toZoneId, type ZoneId } from "@/lib/zones";

export type HistoricFilterQuery = {
  borough: string | null;
  listedOnly: boolean;
  hasDate: boolean;
  sort: "oldest" | "az" | "borough";
  page: number;
};

export type PubsFilterQuery = {
  source: "all" | ScrapedPubSourceId;
  zone: ZoneId | null;
  page: number;
};

export const INDEX_PAGE_SIZE = 24;

type QueryInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeBorough(value: string | undefined): string | null {
  if (!value || value.length > 80) return null;
  // Borough names are human text, never a path or a query expression.
  return /^[\p{L}\p{M}][\p{L}\p{M} &'.,-]*$/u.test(value) ? value : null;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "on";
}

function safePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export function parseHistoricFilterQuery(
  input: QueryInput,
): HistoricFilterQuery {
  const sort = first(input.sort);
  return {
    borough: safeBorough(first(input.borough)),
    listedOnly: truthy(first(input.listed)),
    hasDate: truthy(first(input.date)),
    sort:
      sort === "az" || sort === "borough" || sort === "oldest"
        ? sort
        : "oldest",
    page: safePage(first(input.page)),
  };
}

const PUB_SOURCES: readonly PubsFilterQuery["source"][] = [
  "all",
  "greene-king.co.uk",
  "nicholsonspubs.co.uk",
  "youngs.co.uk",
  "other",
];

export function parsePubsFilterQuery(input: QueryInput): PubsFilterQuery {
  const source = first(input.source);
  return {
    source: PUB_SOURCES.includes(source as PubsFilterQuery["source"])
      ? (source as PubsFilterQuery["source"])
      : "all",
    zone: toZoneId(first(input.zone)),
    page: safePage(first(input.page)),
  };
}

export function paginateIndexRows<T>(
  rows: readonly T[],
  requestedPage: number,
): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / INDEX_PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage)));
  const start = (page - 1) * INDEX_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + INDEX_PAGE_SIZE),
    page,
    totalPages,
  };
}

export function historicIndexHref(
  filters: HistoricFilterQuery,
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.borough) params.set("borough", filters.borough);
  if (filters.listedOnly) params.set("listed", "1");
  if (filters.hasDate) params.set("date", "1");
  if (filters.sort !== "oldest") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/historic?${query}` : "/historic";
}

export function pubsIndexHref(filters: PubsFilterQuery, page: number): string {
  const params = new URLSearchParams();
  if (filters.source !== "all") params.set("source", filters.source);
  if (filters.zone !== null) params.set("zone", String(filters.zone));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/pubs?${query}` : "/pubs";
}

/** Byte count for the intentionally small object crossing a client boundary. */
export function clientFilterPayloadBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof TextEncoder === "undefined") return json.length;
  return new TextEncoder().encode(json).byteLength;
}
