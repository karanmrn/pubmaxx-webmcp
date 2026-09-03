// Runtime events-provider seam for the Tonight surface.
//
// The build-time What's-On EVENTS vertical (scripts/whatson/eventsRefresh.mjs)
// ingests Ticketmaster + Skiddle into the bundled events_london.json baseline.
// This module is the sibling REQUEST-TIME seam: a small provider interface plus
// a fail-soft aggregator, so a live-per-request source (today: Eventbrite) can
// contribute WhatsOnRow[] into the same Tonight surface without a build/deploy.
//
// Every provider returns rows in the exact B1 WhatsOnRow contract
// (lib/whatsOn.ts) with real provenance. The aggregator runs only CONFIGURED
// providers, isolates each one (a throw or timeout degrades to that provider
// contributing zero rows, never an error to the caller), and de-dupes the
// union with the spine's own dedupeRows.

import { dedupeRows, filterTonight, type WhatsOnRow } from "@/lib/whatsOn";

export type EventsProviderContext = {
  /** Absolute "now" (ms), injectable for deterministic tests. */
  now: number;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
  /**
   * City id the ask is about. Absent means London. A provider that can aim at a
   * point resolves the centre from the shared city table, so turning a city on
   * is data rather than code.
   */
  city?: string;
  /**
   * The window the CALLER will keep. Absent means tonight's service window. A
   * provider that can ask its upstream for a window uses this, so a request for
   * tomorrow does not spend an upstream call on rows the caller then discards.
   */
  window?: { startMs: number; endMs: number };
  /** Whether this call must bypass the shared provider response cache. */
  cache?: "default" | "bypass";
};

export type EventsProvider = {
  /** Stable, human-readable provider name (also the log/attribution tag). */
  readonly name: string;
  /** True when this provider has the credentials it needs to run at all. */
  isConfigured(): boolean;
  /**
   * Fetch this provider's tonight-window rows. MAY throw / reject; the
   * aggregator isolates the failure. MUST return rows in the WhatsOnRow shape
   * with real provenance, already narrowed to what the provider legally may
   * surface.
   */
  fetchTonight(ctx: EventsProviderContext): Promise<WhatsOnRow[]>;
};

export type EventsProviderReport = {
  name: string;
  configured: boolean;
  rows: number;
  error?: string;
};

export type AggregatedTonightEvents = {
  rows: WhatsOnRow[];
  providers: EventsProviderReport[];
};

/**
 * Run every CONFIGURED provider fail-soft, re-window each result to tonight
 * (defence in depth: a provider that over-fetches cannot leak non-tonight
 * rows), then de-dupe the union. Unconfigured providers are reported but never
 * called. A single provider's throw is caught and recorded, never propagated.
 */
export async function aggregateTonightEvents(
  providers: EventsProvider[],
  ctx: EventsProviderContext,
): Promise<AggregatedTonightEvents> {
  const reports: EventsProviderReport[] = [];
  const collected: WhatsOnRow[] = [];

  await Promise.all(
    providers.map(async (provider) => {
      if (!provider.isConfigured()) {
        reports.push({ name: provider.name, configured: false, rows: 0 });
        return;
      }
      try {
        const raw = await provider.fetchTonight(ctx);
        const rows = filterTonight(raw, ctx.now);
        collected.push(...rows);
        reports.push({ name: provider.name, configured: true, rows: rows.length });
      } catch (err) {
        reports.push({
          name: provider.name,
          configured: true,
          rows: 0,
          error: err instanceof Error ? err.message : "provider failed",
        });
      }
    }),
  );

  // Stable report order (Promise.all resolves out of order under concurrency).
  reports.sort((a, b) => a.name.localeCompare(b.name));
  const rows = dedupeRows(collected).sort(
    (a, b) =>
      (a.startsAt ?? "").localeCompare(b.startsAt ?? "") ||
      a.id.localeCompare(b.id),
  );
  return { rows, providers: reports };
}
