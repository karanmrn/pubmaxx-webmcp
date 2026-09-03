import "server-only";

import type { PicksListReadStatus } from "@/lib/dayGreeting";
import { outWindowToApiDay } from "@/lib/outListings";
import { buildOutResponse } from "@/lib/out/loadOut";
import {
  mergeTonightListingRows,
  tonightListingsStatus,
  type TonightOutAnswer,
  type TonightWhatsOnStatus,
} from "@/lib/tonightOutListings";
import {
  loadWhatsOn,
  type LoadWhatsOnResult,
  type WhatsOnReadStatus,
} from "@/lib/whatsOnStore";

/** Map the bundled What's-On read into Tonight's spine status vocabulary. */
export function whatsOnStatusForTonightListings(
  readStatus: WhatsOnReadStatus,
  rowCount: number,
): TonightWhatsOnStatus {
  if (readStatus === "degraded") return "error";
  return rowCount > 0 ? "ready" : "empty";
}

/**
 * What the Today picks card may claim after both lanes answer.
 *
 * Tonight merges What's-On and Out before it paints; Today must use the same
 * merged truth so a quiet bundled spine never reads as an empty night while
 * Ticketmaster rows are on /tonight.
 */
export function todayPicksReadStatus(
  whatsOnReadStatus: WhatsOnReadStatus,
  whatsOnRowCount: number,
  out: TonightOutAnswer,
  now: number,
  whatsOnRows: readonly import("@/lib/whatsOn").WhatsOnRow[] = [],
): PicksListReadStatus {
  const whatsOnStatus = whatsOnStatusForTonightListings(whatsOnReadStatus, whatsOnRowCount);
  const listingsStatus = tonightListingsStatus(
    whatsOnStatus,
    out,
    now,
    whatsOnRows,
    undefined,
    false,
  );
  return listingsStatus === "error" ? "degraded" : "ready";
}

/** Bundled plus live What's-On for tonight — same spine as /api/whats-on. */
export async function loadTodayWhatsOnAnswer(now: number): Promise<LoadWhatsOnResult | null> {
  try {
    return await loadWhatsOn({ window: "tonight" }, { now });
  } catch (err) {
    console.warn(
      "[today] whats-on read failed; picks degraded:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Out events for tonight, fail-soft like the /api/out route. */
export async function loadTodayOutAnswer(now: number): Promise<TonightOutAnswer> {
  try {
    const body = await buildOutResponse(
      { city: "london", day: outWindowToApiDay("tonight") },
      { now },
    );
    return { body, failed: false, pending: false };
  } catch (err) {
    console.warn(
      "[today] out read failed; picks degraded:",
      err instanceof Error ? err.message : String(err),
    );
    return { body: null, failed: true, pending: false };
  }
}

/** One merged tonight listing set: What's-On rows plus Out events. */
export function mergeTodayListingRows(
  whatsOnRows: readonly import("@/lib/whatsOn").WhatsOnRow[],
  out: TonightOutAnswer,
  now: number,
  whatsOnStatus: TonightWhatsOnStatus = whatsOnRows.length > 0 ? "ready" : "empty",
): import("@/lib/whatsOn").WhatsOnRow[] {
  return mergeTonightListingRows(
    whatsOnRows,
    out.body?.events ?? [],
    now,
    whatsOnStatus,
    undefined,
    false,
  );
}
