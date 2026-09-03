// Group presence in The Round — "your crew is here" (docs/IDEAS_2026-07-07.md B6).
//
// The honest, zero-schema intersection: The Round already tracks its `members`
// (self-asserted handles) and its `stops` (the self-building route). Venue
// presence already tracks "who tapped 'I'm here' at venue X" as ephemeral,
// opt-in, handle-PUBLIC rows (lib/presenceStore — the PresenceDTO carries the
// handle + venue name, never the actor_hash, and every read is already
// TTL-filtered `expires_at > now`). This module is the pure lens that overlaps
// the two: of the crew who are OUT in this Round, which are marked present at
// the Round's CURRENT stop right now?
//
// ─────────────────────────────────────────────────────────────────────────────
// HONESTY CONTRACT — read before widening anything.
// ─────────────────────────────────────────────────────────────────────────────
//   • Presence is SELF-ASSERTED and EPHEMERAL. A "here now" marker means only
//     "this handle tapped 'I'm here' at this venue within the presence TTL" —
//     never a GPS fix, never a claim that outlives the tap's ~2h window.
//   • NO new exposure. We intersect data that is ALREADY handle-public: round
//     members are public handles on the Round page; presence rows are the same
//     public handle@venue rows the "Live tonight" strip renders. The overlap of
//     two public sets is not more sensitive than either — we surface no field
//     (no actor_hash, no raw id) that either source withheld.
//   • DEFENSIVE TTL. recentPresence() already drops expired rows server-side, so
//     the caller normally passes live rows. But this module re-filters on the
//     PresenceDTO `at` timestamp against `now` + `ttlMs` so it stays honest even
//     if handed a stale/unfiltered list (a test, a cached response, a future
//     caller). A row with a missing/unparseable/future `at` is treated as NOT
//     present — we never over-claim someone is here.
//
// Pure + side-effect-free: no store import, no clock coupling beyond the `now`
// you pass. The page composes the EXISTING GET /api/presence?venueId=… read with
// the Round state it already polls; no new endpoint, no new table.

import { PRESENCE_TTL_MS, type PresenceDTO } from "@/lib/presence";
import { normalizeHandle } from "@/lib/profiles";
import type { RoundMemberDTO, RoundStopDTO } from "@/lib/rounds";

// Re-export so callers can depend on one module for the whole feature. The DTOs
// themselves live with their owners (presenceStore / rounds).
export type { PresenceDTO } from "@/lib/presence";

/**
 * The Round's CURRENT stop — the newest one on the self-building route, i.e. the
 * pub the crew has most recently arrived at. `stops` is stored oldest-first (the
 * route is a numbered 1..N list), so the current stop is the LAST element.
 * Returns null for a Round with no stops yet (nothing to check presence against).
 */
export function currentStop(stops: readonly RoundStopDTO[]): RoundStopDTO | null {
  if (!stops || stops.length === 0) return null;
  return stops[stops.length - 1];
}

/**
 * Is a presence row live at `now`? A row is live iff its `at` timestamp parses,
 * isn't in the future (clock-skew / bad data), and is within `ttlMs` of now.
 * Defensive: recentPresence already TTL-filters, but re-checking here means a
 * stale/unfiltered list can never make us claim someone is present past the TTL.
 */
function isLivePresence(row: PresenceDTO, now: number, ttlMs: number): boolean {
  if (!row?.at) return false;
  const t = Date.parse(row.at);
  if (!Number.isFinite(t)) return false;
  if (t > now) return false; // future-dated → not trusted
  return now - t < ttlMs;
}

/** What the Round page needs to render the "your crew is here" surface. */
export type RoundPresence = {
  /** The stop the presence is scoped to (the current stop), or null if none. */
  stop: RoundStopDTO | null;
  /**
   * The canonical handles of crew members marked present at the current stop
   * right now — a Set for O(1) per-row lookup when rendering member rows. Handles
   * are normalized so a member and a presence row match regardless of casing.
   */
  presentHandles: ReadonlySet<string>;
  /** presentHandles.size — the "N of your crew are here" number. */
  count: number;
  /** Total crew size (members.length) — the "of M" denominator, if wanted. */
  crewSize: number;
};

const EMPTY: RoundPresence = {
  stop: null,
  presentHandles: new Set<string>(),
  count: 0,
  crewSize: 0,
};

/**
 * Intersect (round members × venue presence) at the Round's CURRENT stop.
 *
 * @param members  the Round's members (public handles).
 * @param stops    the Round's stops (route, oldest-first); the current stop is last.
 * @param presence presence rows — pass the list from GET /api/presence?venueId=…
 *                 for the CURRENT stop's venue (already scoped + TTL-filtered).
 *                 Rows for other venues are ignored defensively, so passing an
 *                 unscoped list is safe (only current-stop rows ever count).
 * @param now      the clock (injectable for deterministic tests).
 * @param ttlMs    the presence window; defaults to the store's PRESENCE_TTL_MS so
 *                 this module and the store agree on "still here".
 *
 * Empty cases (no members, no stops, no presence) all collapse to a zero result
 * — the caller renders nothing rather than a broken band, matching the
 * fail-soft-to-empty house contract.
 */
export function roundPresence(
  members: readonly RoundMemberDTO[],
  stops: readonly RoundStopDTO[],
  presence: readonly PresenceDTO[],
  now: number = Date.now(),
  ttlMs: number = PRESENCE_TTL_MS,
): RoundPresence {
  const stop = currentStop(stops);
  if (!stop) return EMPTY;

  const crewSize = members?.length ?? 0;
  if (crewSize === 0) return { ...EMPTY, stop, crewSize: 0 };

  // The set of crew handles, canonicalised, for membership tests.
  const crew = new Set<string>();
  for (const m of members) {
    const h = normalizeHandle(m?.handle ?? "");
    if (h) crew.add(h);
  }
  if (crew.size === 0) return { ...EMPTY, stop, crewSize };

  const presentHandles = new Set<string>();
  for (const row of presence ?? []) {
    // Only presence AT the current stop counts — ignore rows for any other
    // venue even if an unscoped list was handed in.
    if (row?.venueId !== stop.venueId) continue;
    // Defensive TTL: never claim someone is here past the presence window.
    if (!isLivePresence(row, now, ttlMs)) continue;
    const h = normalizeHandle(row.handle ?? "");
    // The intersection: a present handle only counts if they're in the crew.
    if (h && crew.has(h)) presentHandles.add(h);
  }

  return {
    stop,
    presentHandles,
    count: presentHandles.size,
    crewSize,
  };
}

/**
 * The one-line, honest summary string for the "your crew is here" banner. Kept
 * here so the copy is unit-testable and consistent. Never over-claims: it names
 * only the count of present crew, scoped to the current stop's pub name.
 *   0 present → null (render nothing — no honest positive claim to make)
 *   1 present → "1 of your crew is here — <pub>"
 *   n present → "n of your crew are here — <pub>"
 */
export function crewHereSummary(result: RoundPresence): string | null {
  if (result.count === 0 || !result.stop) return null;
  const verb = result.count === 1 ? "is" : "are";
  return `${result.count} of your crew ${verb} here: ${result.stop.venueName}`;
}
