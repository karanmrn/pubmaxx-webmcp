"use client";

// One occupancy read for any surface. Desk mode can adopt this later.
// A held answer ages every minute and is re-read the moment it leaves the
// 90-minute window, so the surface never settles on a reading it derived
// from an answer the server has already moved past.

import { useCallback, useEffect, useMemo, useState } from "react";

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import {
  occupancyAnswerAfter,
  occupancyNowFromReports,
  parseOccupancyLevel,
  type OccupancyLevel,
  type OccupancyNowAnswer,
} from "@/lib/occupancy";

export type OccupancySurface = "venue-sheet" | "pal";

export type VenueOccupancyReading = OccupancyNowAnswer;

function failedReading(): VenueOccupancyReading {
  return occupancyNowFromReports([], Date.now(), { degraded: true });
}

function parseReading(body: unknown): VenueOccupancyReading {
  if (!body || typeof body !== "object") return failedReading();
  const row = body as Record<string, unknown>;
  if (row.degraded === true) return failedReading();
  const now = parseOccupancyLevel(row.now);
  const ageMinutes =
    typeof row.ageMinutes === "number" && Number.isFinite(row.ageMinutes)
      ? Math.max(0, Math.floor(row.ageMinutes))
      : null;
  const reportersLast90 =
    typeof row.reportersLast90 === "number" && Number.isFinite(row.reportersLast90)
      ? Math.max(0, Math.floor(row.reportersLast90))
      : 0;
  const state =
    row.state === "fresh" ||
    row.state === "stale" ||
    row.state === "none" ||
    row.state === "degraded"
      ? row.state
      : now
        ? "fresh"
        : "none";
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
  return {
    now: now && ageMinutes != null ? now : null,
    ageMinutes: now ? ageMinutes : null,
    reportersLast90,
    degraded: false,
    state,
    id,
  };
}

export async function fetchVenueOccupancy(
  venueId: string,
): Promise<VenueOccupancyReading> {
  try {
    const res = await fetch(
      `/api/venues/${encodeURIComponent(venueId)}/occupancy`,
    );
    if (!res.ok) {
      discardBody(res);
      return failedReading();
    }
    return parseReading(await res.json());
  } catch {
    return failedReading();
  }
}

export async function flagVenueOccupancy(
  venueId: string,
  id: string,
  auth: AccountAuthSnapshot | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = auth
      ? await accountBoundFetch(
          auth,
          `/api/venues/${encodeURIComponent(venueId)}/occupancy`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "report", id }),
          },
        )
      : await fetch(`/api/venues/${encodeURIComponent(venueId)}/occupancy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "report", id }),
        });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        error: errorMessageFrom(body, "Could not send that report."),
      };
    }
    await discardBody(res);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not send that report." };
  }
}

export async function postVenueOccupancy(
  venueId: string,
  level: OccupancyLevel,
  auth: AccountAuthSnapshot,
): Promise<
  | { ok: true; reading: VenueOccupancyReading }
  | { ok: false; error: string }
> {
  try {
    const res = await accountBoundFetch(
      auth,
      `/api/venues/${encodeURIComponent(venueId)}/occupancy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        error: errorMessageFrom(body, "Could not save that crowd report."),
      };
    }
    return { ok: true, reading: parseReading(await res.json()) };
  } catch {
    return { ok: false, error: "Could not save that crowd report." };
  }
}

const readsSeen = new Set<string>();

/**
 * ONE emission policy for `occupancy_read`, shared by every surface: at most
 * one event per venue per state for the page session. The event carries no
 * venue id, so a second policy on another surface would make the figure mean
 * two different things at once.
 */
export function trackOccupancyRead(venueId: string, state: string): void {
  if (
    state !== "fresh" &&
    state !== "stale" &&
    state !== "none" &&
    state !== "degraded"
  ) {
    return;
  }
  const key = `${venueId}:${state}`;
  if (readsSeen.has(key)) return;
  readsSeen.add(key);
  trackEvent("occupancy_read", { state });
}

export function __resetOccupancyReadTracking(): void {
  readsSeen.clear();
}

export async function confirmOccupancyProposal(
  input: { venueId: string; level: OccupancyLevel },
  auth: AccountAuthSnapshot | null,
  surface: OccupancySurface,
): Promise<
  | { ok: true; reading: VenueOccupancyReading }
  | { ok: false; error: string; needsSignIn?: boolean }
> {
  if (!auth) {
    return {
      ok: false,
      error: "Sign in to report how busy it is.",
      needsSignIn: true,
    };
  }
  const result = await postVenueOccupancy(input.venueId, input.level, auth);
  if (!result.ok) return result;
  trackEvent("occupancy_reported", { level: input.level, surface });
  trackOccupancyRead(input.venueId, result.reading.state);
  return result;
}

type HeldReading = {
  venueId: string;
  answer: VenueOccupancyReading;
  atMs: number;
};

const OCCUPANCY_TICK_MS = 60_000;

export function useVenueOccupancy(venueId: string, active = true) {
  const [held, setHeld] = useState<HeldReading | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hold = useCallback(
    (answer: VenueOccupancyReading) => {
      const atMs = Date.now();
      setHeld({ venueId, answer, atMs });
      setClockMs(atMs);
    },
    [venueId],
  );

  const reload = useCallback(async () => {
    const next = await fetchVenueOccupancy(venueId);
    hold(next);
    return next;
  }, [hold, venueId]);

  useEffect(() => {
    if (!active || !venueId) return;
    let cancelled = false;
    void fetchVenueOccupancy(venueId).then((next) => {
      if (!cancelled) hold(next);
    });
    return () => {
      cancelled = true;
    };
  }, [active, hold, venueId]);

  const reading = useMemo(() => {
    if (!held || held.venueId !== venueId) return null;
    return occupancyAnswerAfter(held.answer, clockMs - held.atMs);
  }, [clockMs, held, venueId]);

  // A held answer keeps ageing while the surface stays open, so the minute it
  // prints stays true and the 90-minute rule still decides it.
  const ageing = active && (reading?.now ?? null) !== null;
  useEffect(() => {
    if (!ageing) return;
    const timer = setInterval(() => setClockMs(Date.now()), OCCUPANCY_TICK_MS);
    return () => clearInterval(timer);
  }, [ageing]);

  // Leaving the window is the one moment the held answer stops being able to
  // answer at all. The server may hold a report from a minute ago, so the
  // surface asks again rather than settling on a reading it derived itself.
  const agedOut =
    active &&
    held !== null &&
    held.venueId === venueId &&
    held.answer.now !== null &&
    reading?.now == null;
  useEffect(() => {
    if (!agedOut) return;
    // reload holds its answer only after a network round trip, so nothing is
    // set synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refetch
    void reload();
  }, [agedOut, reload]);

  const report = useCallback(
    async (level: OccupancyLevel, auth: AccountAuthSnapshot) => {
      setReporting(true);
      setError(null);
      const result = await postVenueOccupancy(venueId, level, auth);
      setReporting(false);
      if (!result.ok) {
        setError(result.error);
        return result;
      }
      hold(result.reading);
      return result;
    },
    [hold, venueId],
  );

  return { reading, report, reporting, error, reload };
}
