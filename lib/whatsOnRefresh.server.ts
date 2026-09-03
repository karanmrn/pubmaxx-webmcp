import "server-only";

// Official-API What's-On refresh for the Vercel cron. Ticketmaster and Skiddle
// already run inside a function (lib/events/liveProvider.ts, 8s timeout, 100-row
// cap). This module asks them for the Out window (today through the later of
// tomorrow and this weekend), drops expired rows, and writes each feed kind to
// the durable store. Non-event refreshers stay bounded for serverless limits.
//
// A provider that is not configured, or that throws, does not wipe its prior
// rows. A kind is replaced only after its complete refresh lane answers.

import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { outDayWindow, type OutLiveProvider } from "@/lib/out/loadOut";
import { attachOutVenues, type OutVenueMatchIndex } from "@/lib/out/venueMatch";
import { loadOutVenueMatchIndex } from "@/lib/out/venueMatch.server";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import {
  dedupeRows,
  filterNotPast,
  isWhatsOnKind,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { isServableWhatsOnRow } from "@/lib/whatsOnListings";
import {
  whatsOnListingStore,
  type WhatsOnListingStore,
} from "@/lib/whatsOnListingStore";
import {
  buildWetherspoonsDealRows,
  filterGreaterLondonWetherspoons,
  WETHERSPOONS_DEALS,
} from "../scripts/whatson/dealsRefresh.mjs";
import {
  buildMusicResidencyRows,
  MUSIC_RESIDENCIES,
} from "../scripts/whatson/musicRefresh.mjs";
import {
  buildSportFixtureRows,
  SPORT_FIXTURES,
} from "../scripts/whatson/sportFixtures.mjs";
import {
  buildQuestionOneRows,
  isGreaterLondonLatLng,
  parseQuestionOneNextPage,
  parseQuestionOneVenuesPage,
} from "../scripts/whatson/quizParsers.mjs";
import { loadCanonicalVenueIndex } from "../scripts/whatson/resolveVenueId.mjs";
import rawWetherspoons from "../public/data/wetherspoons/pubs.json";
import rawSportAttributes from "../public/data/whats_on/sport_attributes.json";

export type OfficialWhatsOnProviderReport = {
  name: string;
  configured: boolean;
  rows: number;
  fetched?: number;
  dateValid?: number;
  cityValid?: number;
  matchStatus?: "not-run" | "ready" | "unavailable";
  matched?: number;
  unmatched?: number;
  error?: string;
};

export type OfficialWhatsOnRefreshResult = {
  ok: boolean;
  mode: "providers" | "no-providers";
  written: number;
  observedAt: string | null;
  providers: OfficialWhatsOnProviderReport[];
};

export type RefreshOfficialWhatsOnListingsOpts = {
  now?: number;
  store?: WhatsOnListingStore;
  providers?: OutLiveProvider[];
  loadVenueMatchIndex?: () => Promise<OutVenueMatchIndex | null>;
};

export type WhatsOnKindRefreshReport = {
  name: string;
  kind: WhatsOnKind;
  rows: number;
  error?: string;
};

export type RefreshWhatsOnListingsOpts = RefreshOfficialWhatsOnListingsOpts & {
  refreshers?: Partial<Record<WhatsOnKind, () => Promise<WhatsOnRow[]>>>;
};

function providerKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-GB");
}

function preserveUnrefreshedRows(
  rows: WhatsOnRow[],
  reports: OfficialWhatsOnProviderReport[],
): WhatsOnRow[] {
  const refreshedProviders = new Set(
    reports.filter((report) => report.configured).map((report) => providerKey(report.name)),
  );
  return rows.filter(
    (row) =>
      isServableWhatsOnRow(row) &&
      !refreshedProviders.has(providerKey(row.source.label)),
  );
}

function rowsByKind(rows: WhatsOnRow[]): Map<WhatsOnKind, WhatsOnRow[]> {
  const grouped = new Map<WhatsOnKind, WhatsOnRow[]>();
  for (const row of rows) {
    if (!isWhatsOnKind(row.kind) || !isServableWhatsOnRow(row)) continue;
    const current = grouped.get(row.kind) ?? [];
    current.push(row);
    grouped.set(row.kind, current);
  }
  return grouped;
}

type OfficialProviderRefreshEntry = {
  report: OfficialWhatsOnProviderReport;
  rows: WhatsOnRow[];
};

type ProviderRowsMatchResult = {
  ok: boolean;
  rows: WhatsOnRow[];
  reports: OfficialWhatsOnProviderReport[];
};

function reportVenueMatches(
  entry: OfficialProviderRefreshEntry,
  status: "ready" | "unavailable",
  rows: WhatsOnRow[],
): OfficialWhatsOnProviderReport {
  const matched = rows.filter((row) => canonicalOutVenueId(row.venueId) !== null).length;
  return {
    ...entry.report,
    matchStatus: status,
    matched,
    unmatched: entry.rows.length - matched,
  };
}

async function matchProviderRowsForStore(
  entries: OfficialProviderRefreshEntry[],
  loadVenueMatchIndex: () => Promise<OutVenueMatchIndex | null>,
): Promise<ProviderRowsMatchResult> {
  const providerRows = entries.flatMap((entry) => entry.rows);
  if (providerRows.length === 0) {
    return {
      ok: true,
      rows: [],
      reports: entries.map((entry) =>
        entry.report.configured && entry.report.error === undefined
          ? reportVenueMatches(entry, "ready", entry.rows)
          : entry.report,
      ),
    };
  }

  let index: OutVenueMatchIndex | null;
  try {
    index = await loadVenueMatchIndex();
  } catch {
    index = null;
  }

  if (!index || (index.exactByKey.size === 0 && index.byNormalizedName.size === 0)) {
    return {
      ok: false,
      rows: [],
      reports: entries.map((entry) =>
        entry.report.configured && entry.report.error === undefined
          ? reportVenueMatches(entry, "unavailable", [])
          : entry.report,
      ),
    };
  }

  const matchedEntries = entries.map((entry) => {
    if (!entry.report.configured || entry.report.error !== undefined) return entry;
    const rows = attachOutVenues(entry.rows, index).rows;
    return {
      rows,
      report: reportVenueMatches(entry, "ready", rows),
    };
  });
  return {
    ok: true,
    rows: matchedEntries.flatMap((entry) => entry.rows),
    reports: matchedEntries.map((entry) => entry.report),
  };
}

function officialRefreshWindow(now: number): { startMs: number; endMs: number } {
  const today = outDayWindow("today", now);
  const tomorrow = outDayWindow("tomorrow", now);
  const weekend = outDayWindow("weekend", now);
  return {
    startMs: today.startMs,
    endMs: Math.max(tomorrow.endMs, weekend.endMs),
  };
}

function defaultProviders(): OutLiveProvider[] {
  return [createTicketmasterProvider(), createSkiddleProvider()];
}

export async function refreshOfficialWhatsOnListings(
  opts: RefreshOfficialWhatsOnListingsOpts = {},
): Promise<OfficialWhatsOnRefreshResult> {
  const now = opts.now ?? Date.now();
  const store = opts.store ?? whatsOnListingStore();
  const providers = opts.providers ?? defaultProviders();
  const window = officialRefreshWindow(now);

  const settled = await Promise.all(
    providers.map(
      async (
        provider,
      ): Promise<{ report: OfficialWhatsOnProviderReport; rows: WhatsOnRow[] }> => {
        if (!provider.isConfigured()) {
          return {
            report: {
              name: provider.name,
              configured: false,
              rows: 0,
              fetched: 0,
              dateValid: 0,
              cityValid: 0,
              matchStatus: "not-run",
              matched: 0,
              unmatched: 0,
            },
            rows: [],
          };
        }
        try {
          const raw = await provider.fetchTonight({
            now,
            city: "london",
            window,
            cache: "bypass",
          });
          const dateValid = filterNotPast(raw, now);
          const cityValid = dateValid.filter((row) => {
            if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return true;
            return isGreaterLondonLatLng(row.lat as number, row.lng as number);
          });
          const kept = cityValid.filter(isServableWhatsOnRow);
          return {
            report: {
              name: provider.name,
              configured: true,
              rows: kept.length,
              fetched: raw.length,
              dateValid: dateValid.length,
              cityValid: cityValid.length,
              matchStatus: "not-run",
              matched: 0,
              unmatched: kept.length,
            },
            rows: kept,
          };
        } catch (err) {
          return {
            report: {
              name: provider.name,
              configured: true,
              rows: 0,
              fetched: 0,
              dateValid: 0,
              cityValid: 0,
              matchStatus: "not-run",
              matched: 0,
              unmatched: 0,
              error: err instanceof Error ? err.message : String(err),
            },
            rows: [],
          };
        }
      },
    ),
  );

  let reports = settled.map((entry) => entry.report);
  const anyConfigured = reports.some((report) => report.configured);
  if (!anyConfigured) {
    return {
      ok: false,
      mode: "no-providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  const configuredReports = reports.filter((report) => report.configured);
  if (configuredReports.some((report) => report.error !== undefined)) {
    return {
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  const providerMatch = await matchProviderRowsForStore(
    settled,
    opts.loadVenueMatchIndex ?? (() => loadOutVenueMatchIndex("london")),
  );
  reports = providerMatch.reports;
  if (!providerMatch.ok) {
    return {
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  const grouped = rowsByKind(providerMatch.rows);
  if (reports.some((report) => !report.configured)) {
    const previous = await store.readAll();
    if (previous.failed) {
      return {
        ok: false,
        mode: "providers",
        written: 0,
        observedAt: null,
        providers: reports,
      };
    }
    for (const row of preserveUnrefreshedRows(previous.rows, reports)) {
      const current = grouped.get(row.kind) ?? [];
      current.push(row);
      grouped.set(row.kind, current);
    }
  }
  if (
    !grouped.has("event") &&
    settled.every((entry) => entry.rows.every((row) => row.kind === "event"))
  ) {
    grouped.set("event", []);
  }
  const generatedAt = new Date(now).toISOString();
  let written = 0;
  for (const [kind, kindRows] of grouped) {
    let outcome: Awaited<ReturnType<WhatsOnListingStore["replaceKind"]>>;
    try {
      outcome = await store.replaceKind(kind, dedupeRows(kindRows), generatedAt);
    } catch {
      return {
        ok: false,
        mode: "providers",
        written,
        observedAt: written > 0 ? generatedAt : null,
        providers: reports,
      };
    }
    if (outcome.failed) {
      return {
        ok: false,
        mode: "providers",
        written,
        observedAt: written > 0 ? generatedAt : null,
        providers: reports,
      };
    }
    written += outcome.written;
  }

  return {
    ok: true,
    mode: "providers",
    written,
    observedAt: generatedAt,
    providers: reports,
  };
}

async function refreshQuestionOneQuiz(now: number): Promise<WhatsOnRow[]> {
  const observedAt = new Date(now).toISOString();
  const cards = [];
  const seenUrls = new Set<string>();
  let url: string | null = "https://questionone.com/venues/";

  for (let page = 0; url && page < 4; page += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Question One returned ${response.status}`);
    const html = await response.text();
    for (const card of parseQuestionOneVenuesPage(html)) {
      if (seenUrls.has(card.url)) continue;
      seenUrls.add(card.url);
      cards.push(card);
    }
    url = parseQuestionOneNextPage(html);
  }

  const venueIndex = loadCanonicalVenueIndex();
  return buildQuestionOneRows({ cards, observedAt, venueIndex }).rows as WhatsOnRow[];
}

function defaultKindRefreshers(now: number): Record<WhatsOnKind, () => Promise<WhatsOnRow[]>> {
  const observedAt = new Date(now).toISOString();
  const venueIndex = loadCanonicalVenueIndex();
  const wetherspoons = Array.isArray(rawWetherspoons.pubs) ? rawWetherspoons.pubs : [];
  const attributes = Array.isArray(rawSportAttributes.rows) ? rawSportAttributes.rows : [];

  return {
    event: async () => [],
    quiz: () => refreshQuestionOneQuiz(now),
    deal: async () =>
      buildWetherspoonsDealRows({
        deals: WETHERSPOONS_DEALS,
        venues: filterGreaterLondonWetherspoons(wetherspoons),
        observedAt,
        venueIndex,
      }) as WhatsOnRow[],
    music: async () =>
      buildMusicResidencyRows({
        residencies: MUSIC_RESIDENCIES,
        observedAt,
        venueIndex,
      }) as WhatsOnRow[],
    sport: async () =>
      buildSportFixtureRows({
        attributeRows: attributes,
        fixtures: SPORT_FIXTURES,
        observedAt,
        venueIndex,
      }) as WhatsOnRow[],
  };
}

export type AllWhatsOnRefreshResult = OfficialWhatsOnRefreshResult & {
  kinds: WhatsOnKindRefreshReport[];
};

export async function refreshWhatsOnListings(
  opts: RefreshWhatsOnListingsOpts = {},
): Promise<AllWhatsOnRefreshResult> {
  const now = opts.now ?? Date.now();
  const store = opts.store ?? whatsOnListingStore();
  const official = await refreshOfficialWhatsOnListings({
    now,
    store,
    providers: opts.providers,
    loadVenueMatchIndex: opts.loadVenueMatchIndex,
  });
  const defaults = defaultKindRefreshers(now);
  const refreshers = { ...defaults, ...(opts.refreshers ?? {}) };
  const kinds: WhatsOnKindRefreshReport[] = [];

  for (const kind of ["quiz", "deal", "music", "sport"] as const) {
    try {
      const rows = (await refreshers[kind]()).filter(
        (row) => row.kind === kind && isServableWhatsOnRow(row),
      );
      const outcome = await store.replaceKind(kind, dedupeRows(filterNotPast(rows, now)), new Date(now).toISOString());
      if (outcome.failed) throw new Error(`${kind} durable write failed`);
      kinds.push({ name: kind, kind, rows: outcome.written });
    } catch (err) {
      kinds.push({
        name: kind,
        kind,
        rows: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const staticFailure = kinds.some((report) => report.error !== undefined);
  const officialUnavailable = official.mode === "no-providers";
  const ok = !staticFailure && (official.ok || officialUnavailable);
  const successfulWrites = kinds.reduce((sum, report) => sum + report.rows, 0);
  return {
    ok,
    mode: ok ? "providers" : official.mode,
    written: official.written + successfulWrites,
    observedAt: ok ? new Date(now).toISOString() : null,
    providers: official.providers,
    kinds,
  };
}
