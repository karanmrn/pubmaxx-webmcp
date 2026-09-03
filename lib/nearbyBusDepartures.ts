export const BUS_PREDICTION_MAX_AGE_MS = 2 * 60_000;
export const BUS_DEPARTURE_HORIZON_MS = 60 * 60_000;

// TfL stamps every prediction in a response from its own clock, so a second or
// two of skew ahead of ours must not throw the whole response away. The stale
// ceiling above is untouched by this tolerance.
export const BUS_PREDICTION_FUTURE_TOLERANCE_MS = 5_000;

// Latency budget. TfL's StopPoint geo query measures around 3s and runs slower
// from a serverless region, so it keeps the 9s headroom the last-train route
// gives the same endpoint: a slow-but-real response must not be aborted and
// reported as a failed check. The route declares BUS_ROUTE_BUDGET_MS as its
// maxDuration and reserves BUS_ROUTE_RESERVE_MS for its own work, so every
// upstream deadline is whatever is left of the budget rather than a fixed slice
// summed by hand. See docs/superpowers/plans/2026-07-28-nearby-bus-departures.md.
export const BUS_ROUTE_BUDGET_MS = 15_000;
export const BUS_ROUTE_RESERVE_MS = 1_000;
export const BUS_UPSTREAM_BUDGET_MS = BUS_ROUTE_BUDGET_MS - BUS_ROUTE_RESERVE_MS;
export const BUS_STOP_LOOKUP_TIMEOUT_MS = 9_000;
export const BUS_ARRIVALS_TIMEOUT_MS = 5_000;
// An attempt with less time than this cannot succeed, so the route stops and
// answers rather than spending the rest of its budget proving it.
export const BUS_MIN_ATTEMPT_MS = 1_000;

/**
 * What is left of the upstream budget for one call, never more than its own
 * cap and never eating time another call is holding.
 */
export function busUpstreamTimeoutMs(
  capMs: number,
  elapsedMs: number,
  reservedMs = 0,
): number {
  const remaining = BUS_UPSTREAM_BUDGET_MS - elapsedMs - reservedMs;
  return Math.max(0, Math.min(capMs, remaining));
}

// Client cadence. The clock tick keeps a minute-resolution countdown true; the
// refresh interval is what asks TfL again, and only ever while the card is on
// screen. The wait is how long the card shows a spinner before it says it has
// not heard back, which never aborts the request underneath it.
export const BUS_DEPARTURES_TICK_MS = 15_000;
export const BUS_DEPARTURES_REFRESH_MS = 30_000;
export const BUS_DEPARTURES_SLOW_WAIT_MS = 6_000;
// A check old enough to name, and the age past which a counted-down minute
// figure stops being a claim we can stand behind.
export const BUS_DEPARTURES_AGE_NOTE_MS = 60_000;
export const BUS_DEPARTURES_OUT_OF_DATE_MS = BUS_PREDICTION_MAX_AGE_MS;

export type BusDirection = "inbound" | "outbound" | null;

export type TflBusPrediction = {
  naptanId?: string;
  lineName?: string;
  destinationName?: string;
  direction?: string;
  timestamp?: string;
  expectedArrival?: string;
};

// expectedArrival is the only time carried off this module. A relative figure
// frozen at response time is exactly what a countdown must never be built from,
// so none is published for anyone to render.
export type FreshBusPrediction = {
  naptanId: string;
  lineName: string;
  destinationName: string;
  direction: BusDirection;
  expectedArrival: string;
};

export type NearbyBusDeparture = Omit<FreshBusPrediction, "naptanId">;

export type NearbyBusStop = {
  id: string;
  name: string;
  indicator: string | null;
  towards: string | null;
  distanceM: number;
  departures: NearbyBusDeparture[];
};

export type NearbyBusDeparturesResult = {
  status: "ready" | "unavailable";
  stops: NearbyBusStop[];
  generatedAt: string;
};

export function freshBusPredictions(
  predictions: TflBusPrediction[],
  now: Date,
): FreshBusPrediction[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const fresh: FreshBusPrediction[] = [];
  for (const prediction of predictions) {
    const naptanId = prediction.naptanId?.trim() ?? "";
    const lineName = prediction.lineName?.trim() ?? "";
    const destinationName = prediction.destinationName?.trim() ?? "";
    if (!naptanId || !lineName || !destinationName) continue;

    const predictionAt = Date.parse(prediction.timestamp ?? "");
    const expectedAt = Date.parse(prediction.expectedArrival ?? "");
    if (!Number.isFinite(predictionAt) || !Number.isFinite(expectedAt)) continue;

    const ageMs = nowMs - predictionAt;
    const dueMs = expectedAt - nowMs;
    if (
      ageMs < -BUS_PREDICTION_FUTURE_TOLERANCE_MS ||
      ageMs > BUS_PREDICTION_MAX_AGE_MS
    ) {
      continue;
    }
    if (dueMs <= 0 || dueMs > BUS_DEPARTURE_HORIZON_MS) continue;

    const direction =
      prediction.direction === "inbound" || prediction.direction === "outbound"
        ? prediction.direction
        : null;
    fresh.push({
      naptanId,
      lineName,
      destinationName,
      direction,
      expectedArrival: new Date(expectedAt).toISOString(),
    });
  }

  return fresh.sort(
    (a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival),
  );
}

export type BusDeparturesFreshness =
  | { state: "live"; ageMinutes: number }
  | { state: "ageing"; ageMinutes: number }
  | { state: "out-of-date"; ageMinutes: number | null };

/**
 * How much a rendered set of departures can still claim.
 *
 * A check we cannot date is out of date: silence about when it happened is not
 * evidence that it just happened.
 */
export function busDeparturesFreshness(
  generatedAt: string,
  now: Date,
): BusDeparturesFreshness {
  const generatedMs = Date.parse(generatedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(generatedMs) || !Number.isFinite(nowMs)) {
    return { state: "out-of-date", ageMinutes: null };
  }

  const ageMs = Math.max(0, nowMs - generatedMs);
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMs > BUS_DEPARTURES_OUT_OF_DATE_MS) {
    return { state: "out-of-date", ageMinutes };
  }
  if (ageMs >= BUS_DEPARTURES_AGE_NOTE_MS) return { state: "ageing", ageMinutes };
  return { state: "live", ageMinutes };
}

/**
 * Minutes until an arrival, read from the arrival's own absolute time.
 *
 * Never derived from a previously rendered relative figure, so a countdown
 * ages instead of freezing at whatever it said when the response landed.
 */
export function departureDueMinutes(
  expectedArrival: string,
  now: Date,
): number | null {
  const expectedMs = Date.parse(expectedArrival);
  const nowMs = now.getTime();
  if (!Number.isFinite(expectedMs) || !Number.isFinite(nowMs)) return null;
  return Math.ceil((expectedMs - nowMs) / 60_000);
}

/** Live departures are only worth asking for while somebody can see them. */
export function shouldPollBusDepartures(input: {
  open: boolean;
  documentVisible: boolean;
}): boolean {
  return input.open && input.documentVisible;
}

export type BusDeparturesPoll = {
  /** Load now unless one is already in flight. */
  refresh: () => void;
  stop: () => void;
};

/**
 * Tick a clock and re-load on the refresh cadence until `stop` is called.
 * Stopping clears the interval and aborts whatever is in flight, so a closed
 * disclosure, a hidden document, or an unmounted sheet costs nothing.
 *
 * `lastLoadAt` is the floor between restarts: a poll handed a load younger than
 * one refresh interval waits for the interval instead of asking TfL again, so
 * opening and closing the card repeatedly cannot turn into a burst. Loads never
 * overlap, which is also what makes an explicit retry safe.
 */
export function startBusDeparturesPoll({
  tickMs = BUS_DEPARTURES_TICK_MS,
  refreshMs = BUS_DEPARTURES_REFRESH_MS,
  now = () => Date.now(),
  lastLoadAt: seededLoadAt = null,
  onLoadStart,
  onTick,
  load,
}: {
  tickMs?: number;
  refreshMs?: number;
  now?: () => number;
  lastLoadAt?: number | null;
  onLoadStart?: (at: number) => void;
  onTick: (nowMs: number) => void;
  load: (signal: AbortSignal) => Promise<void>;
}): BusDeparturesPoll {
  const controller = new AbortController();
  let inFlight = false;
  let lastLoadAt = seededLoadAt ?? Number.NEGATIVE_INFINITY;

  const run = () => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    lastLoadAt = now();
    onLoadStart?.(lastLoadAt);
    const settle = () => {
      inFlight = false;
    };
    void load(controller.signal).then(settle, settle);
  };

  if (now() - lastLoadAt >= refreshMs) run();
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    const at = now();
    onTick(at);
    if (at - lastLoadAt >= refreshMs) run();
  }, tickMs);

  return {
    refresh: run,
    stop: () => {
      clearInterval(timer);
      controller.abort();
    },
  };
}
