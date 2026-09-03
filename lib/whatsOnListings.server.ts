import "server-only";

// Store-first What's-On reader. Durable official-API rows win when present;
// the committed public/data/whats_on files remain the fallback. Expired rows
// are dropped here, matching filterNotPast on the serving spine.

import { isServableWhatsOnRow, preferDurableWhatsOn } from "@/lib/whatsOnListings";
import {
  whatsOnListingStore,
  type WhatsOnListingStore,
} from "@/lib/whatsOnListingStore";
import {
  filterNotPast,
  filterTonight,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type LoadServedWhatsOnListingsOpts = {
  store?: WhatsOnListingStore;
  bundled: WhatsOnRow[];
  now: number;
  kind?: WhatsOnKind;
  window?: "tonight";
};

export type ServedWhatsOnListings = {
  rows: WhatsOnRow[];
  providerObservedAt: string | null;
  readStatus: "ready" | "degraded";
};

function freshestObservedAt(rows: WhatsOnRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (latest === null || Date.parse(row.observedAt) > Date.parse(latest)) {
      return row.observedAt;
    }
    return latest;
  }, null);
}

export async function loadServedWhatsOnListingsWithFreshness(
  opts: LoadServedWhatsOnListingsOpts,
): Promise<ServedWhatsOnListings> {
  const store = opts.store ?? whatsOnListingStore();
  const snap = await store.readAll();
  if (snap.failed) {
    console.warn("[whats-on] durable listing read failed; using bundled fallback.");
  }
  const durable = snap.failed
    ? []
    : opts.kind
      ? snap.rows.filter((row) => row.kind === opts.kind && isServableWhatsOnRow(row))
      : snap.rows.filter(isServableWhatsOnRow);
  const bundled = opts.kind
    ? opts.bundled.filter((row) => row.kind === opts.kind)
    : opts.bundled;
  const activeDurable = filterNotPast(durable, opts.now);
  const observedDurable =
    opts.window === "tonight" ? filterTonight(activeDurable, opts.now) : activeDurable;
  return {
    rows: preferDurableWhatsOn(durable, bundled, opts.now),
    providerObservedAt: freshestObservedAt(observedDurable),
    readStatus: snap.failed ? "degraded" : "ready",
  };
}

export async function loadServedWhatsOnListings(
  opts: LoadServedWhatsOnListingsOpts,
): Promise<WhatsOnRow[]> {
  return (await loadServedWhatsOnListingsWithFreshness(opts)).rows;
}
