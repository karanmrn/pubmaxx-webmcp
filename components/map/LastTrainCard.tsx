"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

// "Last Pint" card — the signature utility (PRD user stories 19-24). Given a
// venue's coordinates, it fetches the nearest Tube/rail station, a pub-native
// decision ("Order one more" ... "Train risk tonight"), next departures + the
// last train per line, any disruption, and the 3 nearest pubs to the station
// for a final pint by the platform. Wired into the venue panel by the
// orchestrator (VenueInspector) — this file does NOT render itself anywhere.
//
// React 19 rules: the shared sheet-open prefetch resolves in an effect, and
// setState only ever runs inside the async resolution/catch. Unmounted readers
// ignore the shared result without cancelling it for the next consumer.
// Provenance-honest: live copy is scoped to live departures only, while the
// Last Pint decision stays timetable-based; failures get a warm fallback.
//
// Styling: inline style objects, matching the rest of components/map/** (no
// CSS module/import convention exists in this codebase — see styles below).

import { useEffect, useId, useState } from "react";

import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { lastRideProviderForCity, type LastRideResult } from "@/lib/lastRide";
import {
  loadLastRide,
  loadStableLastRide,
  type LastRidePayload,
} from "@/lib/lastRideClient";
import {
  readLastTrainDestination,
  writeLastTrainDestination,
} from "@/lib/lastTrainDestination";
import { nearestStaticStation } from "@/lib/staticStations";
import {
  buildLastPintShareText,
  describeLeaveCountdown,
  lastPintShareHref,
  minutesUntilLeaveBy,
  walkMinutesForKm,
  type LastPintDecision,
  type LastPintDecisionKind,
  type LastTrainResult,
} from "@/lib/tfl";
import { lineDisplayLabel } from "@/lib/tflDisruption";
import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type LastTrainCardProps = {
  lat: number;
  lng: number;
  venueName?: string;
  /** Drives provider path + Last Pint / Last Tram copy. Defaults to London. */
  cityId?: CityId;
  venueKind?: VenueKind;
  // Optional: when provided, tapping one of the 3 station pubs calls this
  // instead of just rendering a plain list. Backward-compatible — VenueInspector
  // (owned by another wave) doesn't pass this today and doesn't need to.
  onSelectVenue?: (venueId: string) => void;
  // Optional: lifts the live Last Pint decision up to the orchestrator so the
  // Pints tab can stamp each drop with an honest "before/after the last train"
  // badge (IDEAS A5). This card owns the visible result and publishes the
  // resolved decision (or null while loading / on failure). The request may
  // already be warm, but no decision is published before this tab opens.
  onDecision?: (decision: LastPintDecision | null) => void;
};

export type LastTrainCardState =
  | { status: "loading" }
  | { status: "ready"; requestKey: string; data: LastTrainResult }
  | { status: "empty"; requestKey: string };

export function lastTrainRequestKey({
  lat,
  lng,
  venueName,
  cityId,
}: {
  lat: number;
  lng: number;
  venueName?: string;
  cityId?: CityId;
}): string {
  // Destination is client-only display state — it must not change the fetch key.
  return `${cityId ?? DEFAULT_CITY_ID}:${lat}:${lng}:${venueName ?? ""}`;
}

export function currentLastTrainState(
  state: LastTrainCardState,
  requestKey: string,
): LastTrainCardState {
  if (state.status !== "loading" && state.requestKey !== requestKey) {
    return { status: "loading" };
  }
  return state;
}

// The API always 200s (even on TfL failure) with either a result or an { error }
// shape; treat anything without a station as "empty" so the card shows the
// friendly note rather than a half-populated panel.
function toState(
  data: Partial<LastTrainResult> & { error?: string },
  requestKey: string,
): LastTrainCardState {
  if (data.station && Array.isArray(data.trains)) {
    return { status: "ready", requestKey, data: data as LastTrainResult };
  }
  return { status: "empty", requestKey };
}

// Pub-voice copy for each decision state (user story 21) — this is the whole
// point: it should read like PUBMAXXING, not a transit dashboard.
export function lastRideLabelForVenue(
  rideLabel: string,
  venueKind: VenueKind | undefined,
): string {
  return !isPubVenueKind(venueKind) && rideLabel === "Last Pint"
    ? "Last train"
    : rideLabel;
}

export function lastRideDecisionCopy(
  kind: LastPintDecisionKind,
  modeLabel: string,
  provider: string | undefined,
  venueKind: VenueKind | undefined,
): string {
  if (!isPubVenueKind(venueKind)) {
    if (kind === "order_one_more") return "Time in hand";
    if (kind === "half_pint_only") return "Brief stop only";
    if (kind === "settle_up_now") return "Head off now";
  }
  switch (kind) {
    case "order_one_more":
      return "Order one more";
    case "half_pint_only":
      return "Half pint only";
    case "settle_up_now":
      return "Settle up now";
    case "train_risk":
      if (modeLabel === "tram") return "Tram risk tonight";
      if (modeLabel === "subway") return "Subway risk tonight";
      return "Train risk tonight";
    case "live_data_unavailable":
      if (provider === "metrolink") return "Can't check Metrolink right now";
      if (provider === "spt-subway") return "Can't check the Subway right now";
      if (provider === "merseyrail") return "Can't check Merseyrail right now";
      return "Can't check TfL right now";
  }
}

// A colour cue per state (brass/warm for relaxed, ink for urgent) using the
// same CSS custom properties the rest of the map panel reads from.
const DECISION_COLOUR: Record<LastPintDecisionKind, string> = {
  order_one_more: "var(--accent-good, #2f7a3d)",
  half_pint_only: "var(--brass, #ff5a5f)",
  settle_up_now: "var(--accent-warn, #b5651d)",
  train_risk: "var(--accent-risk, #b3261e)",
  live_data_unavailable: "var(--ink-soft, #6b726a)",
};

export function provenanceCopyForDepartures(
  departures: LastTrainResult["departures"] | undefined,
): string {
  const hasLiveDepartures = (departures ?? []).some((d) => d.live);
  return hasLiveDepartures
    ? "Live departures from TfL; last train uses the timetable."
    : "Scheduled times from TfL - not a live feed.";
}

export function provenanceCopyForResult(
  data: Partial<LastRideResult> | LastTrainResult,
): string {
  const ride = data as Partial<LastRideResult>;
  if (typeof ride.provenance === "string" && ride.provenance.trim()) {
    return ride.provenance;
  }
  return provenanceCopyForDepartures(ride.departures);
}

function modeWord(data: Partial<LastRideResult> | undefined, cityId: CityId): string {
  if (data?.modeLabel) return data.modeLabel;
  if (cityId === "manchester") return "tram";
  if (cityId === "glasgow") return "subway";
  return "train";
}

function formatLeaveBy(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

type CrewShareOutcome = "shared" | "idle" | "error";

// Hand the composed crew message to the platform: native share sheet first
// (mobile-first — that's where WhatsApp is), else the wa.me deep link. A
// cancelled sheet resolves to "idle" (no error UI); a blocked popup is "error".
async function dispatchCrewShare(shareText: string): Promise<CrewShareOutcome> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ text: shareText });
      return "shared";
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return "idle";
      }
      return "error";
    }
  }
  if (typeof window === "undefined") return "error";
  const opened = window.open(lastPintShareHref(shareText), "_blank", "noopener,noreferrer");
  return opened ? "shared" : "error";
}

function readSessionDestination(): string {
  if (typeof window === "undefined") return "";
  return readLastTrainDestination(window.sessionStorage);
}

// Friction-sweep follow-up 7: when the live check fails entirely, the card
// still hands over the one thing we know without any network — the nearest
// bundled station (lib/staticStations, London-only) and a straight-line walk
// estimate. Static value, clearly not live timings; null when no bundled
// station is within a real walk (a misleading estimate is worse than none).
export function staticStationLine(cityId: CityId, lat: number, lng: number): string | null {
  if (cityId !== "london") return null;
  const nearest = nearestStaticStation(lat, lng);
  if (!nearest) return null;
  const minutes = walkMinutesForKm(nearest.distanceKm);
  if (!Number.isFinite(minutes) || minutes > 30) return null;
  return `Nearest station on our map: ${nearest.name} (${nearest.lines.slice(0, 3).join(", ")}), about ${minutes} min on foot.`;
}

function emptyNoteForCity(cityId: CityId): string {
  if (!lastRideProviderForCity(cityId)) {
    return `No ${getCity(cityId).lastRideLabel.toLowerCase()} provider is available for ${getCity(cityId).displayName} yet.`;
  }
  if (cityId === "manchester") {
    return "Couldn't check Metrolink just now. Check before you head out.";
  }
  if (cityId === "glasgow") {
    return "Couldn't check the Subway just now. Check before you head out.";
  }
  return "Couldn't reach TfL just now. Check before you head out.";
}

function lastServiceLineLabel(lineName: string, mode: string): string {
  if (mode === "tram" || mode === "subway") return `Last ${lineName}`;
  return `Last ${lineDisplayLabel(lineName)}`;
}

function showLondonStaticFallback(
  cityId: CityId,
  data: LastTrainResult | undefined,
): boolean {
  return (
    cityId === "london" &&
    Boolean(data?.staticFallback) &&
    (!data?.trains || data.trains.length === 0)
  );
}

// The pub-native decision + live leave-by countdown + "send to crew" share.
// Extracted from the card body so each stays legible (and under the repo's
// cyclomatic-complexity ceiling). Purely presentational — the parent owns the
// fetch, the decision, and the share dispatch.
function DecisionBlock({
  decision,
  mode,
  provider,
  leaveBy,
  countdownPhrase,
  shareState,
  onShare,
  venueKind,
}: {
  decision: LastPintDecision;
  mode: string;
  provider: string | undefined;
  leaveBy: string | null;
  countdownPhrase: string | null;
  shareState: "idle" | "shared" | "error";
  onShare: () => void;
  venueKind?: VenueKind;
}) {
  const showLeaveBy = Boolean(leaveBy) && decision.decision !== "live_data_unavailable";
  return (
    <div style={styles.decision}>
      <p style={{ ...styles.decisionLine, color: DECISION_COLOUR[decision.decision] }}>
        {lastRideDecisionCopy(decision.decision, mode, provider, venueKind)}
      </p>
      {showLeaveBy ? (
        <p style={styles.leaveBy}>
          Leave by {leaveBy} for the last {mode}
          {countdownPhrase ? <span style={styles.countdown}> · {countdownPhrase}</span> : null}.
        </p>
      ) : null}
      {decision.disruptionSummary ? (
        <p style={styles.disruption}>{decision.disruptionSummary}</p>
      ) : null}
      <div style={styles.shareRow}>
        <button type="button" style={styles.shareButton} onClick={onShare}>
          {shareState === "shared" ? "Sent to crew" : "Send to crew"}
        </button>
        {shareState === "error" ? (
          <span style={styles.shareError}>
            {offlineOrMessage("Couldn&apos;t open the share. Try again.")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function LastTrainCard({
  lat,
  lng,
  venueName,
  cityId = DEFAULT_CITY_ID,
  venueKind,
  onSelectVenue,
  onDecision,
}: LastTrainCardProps) {
  const destinationInputId = useId();
  const rideLabel = lastRideLabelForVenue(
    getCity(cityId).lastRideLabel,
    venueKind,
  );
  const [destination, setDestination] = useState(readSessionDestination);
  const [destinationDraft, setDestinationDraft] = useState("");
  const [editingDestination, setEditingDestination] = useState(false);
  const [state, setState] = useState<LastTrainCardState>({ status: "loading" });
  // Live countdown clock. `nowTick` is bumped on an interval so the relative
  // "leave in N min" phrase stays honest without re-fetching; the absolute
  // "Leave by HH:MM" never changes, so this is purely additive.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [shareState, setShareState] = useState<"idle" | "shared" | "error">("idle");
  const requestKey = lastTrainRequestKey({ lat, lng, venueName, cityId });
  const displayState = currentLastTrainState(state, requestKey);

  function saveDestination(raw: string) {
    const next =
      typeof window === "undefined"
        ? raw.trim()
        : writeLastTrainDestination(raw, window.sessionStorage);
    setDestination(next);
    setDestinationDraft(next);
    setEditingDestination(false);
  }

  useEffect(() => {
    const stableRequest = loadStableLastRide(cityId, lat, lng);
    const liveRequest = loadLastRide(cityId, lat, lng);
    let active = true;
    let stableSettled = stableRequest === null;
    let liveSettled = liveRequest === null;
    let hasReadyState = false;
    let hasLiveReadyState = false;

    const settleEmpty = () => {
      if (active && stableSettled && liveSettled && !hasReadyState) {
        setState({ status: "empty", requestKey });
      }
    };

    stableRequest?.then(
      (data: LastRidePayload) => {
        stableSettled = true;
        const next = toState(data, requestKey);
        if (next.status === "ready") {
          hasReadyState = true;
          if (active && !hasLiveReadyState) setState(next);
        }
        settleEmpty();
      },
      () => {
        stableSettled = true;
        settleEmpty();
      },
    );
    liveRequest?.then(
      (data: LastRidePayload) => {
        liveSettled = true;
        const next = toState(data, requestKey);
        if (next.status === "ready") {
          hasReadyState = true;
          hasLiveReadyState = true;
          if (active) setState(next);
        }
        settleEmpty();
      },
      () => {
        liveSettled = true;
        settleEmpty();
      },
    );
    void Promise.resolve().then(settleEmpty);
    return () => {
      active = false;
    };
  }, [lat, lng, venueName, cityId, requestKey]);

  const decision = displayState.status === "ready" ? displayState.data.decision : undefined;

  // Publish the resolved decision up to the orchestrator (if it asked). This is
  // a parent callback, not local setState, so it's allowed in an effect — and it
  // must run in an effect so it fires after render/commit, never mid-render. It
  // re-runs whenever the decision changes (venue switch, refetch) or clears to
  // null while loading / on TfL failure, so the parent's badges stay in sync
  // with what THIS card actually knows.
  useEffect(() => {
    onDecision?.(decision ?? null);
  }, [decision, onDecision]);

  const leaveBy = decision ? formatLeaveBy(decision.leaveByIso) : null;
  // Destination label is sessionStorage-only — never echoed from the API.
  const destinationLabel = destination.trim() || null;
  const readyData =
    displayState.status === "ready" ? (displayState.data as LastRideResult) : undefined;
  const mode = modeWord(readyData, cityId);
  const staticStation = staticStationLine(cityId, lat, lng);

  // Tick the live countdown every 30s while there's an active leave-by time.
  // Calm, not chatty: 30s is fine for a minute-resolution phrase, and we stop
  // the interval entirely once the leave-by moment is well past.
  const leaveByIso = decision?.leaveByIso ?? null;
  const countdownMinutes = minutesUntilLeaveBy(leaveByIso, new Date(nowTick));
  const countdownPhrase = describeLeaveCountdown(countdownMinutes);
  useEffect(() => {
    if (!leaveByIso) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [leaveByIso]);

  // "Send to crew" — compose the WhatsApp-ready message (pure helper) and hand
  // it off to the share dispatcher (native sheet, else wa.me). Branching lives
  // in the module-scope helpers below to keep this component legible.
  function shareToCrew() {
    if (!decision) return;
    const shareText = buildLastPintShareText({
      decision: decision.decision,
      stationName: readyData?.station.name ?? decision.stationName,
      leaveByClock: leaveBy,
      lastServiceClock: readyData?.trains?.[0]?.clock ?? null,
      modeWord: mode,
      destinationLabel,
    });
    void dispatchCrewShare(shareText).then(setShareState);
  }
  // Provenance honesty (H5): prefer provider-supplied copy (Metrolink static);
  // London still scopes the live claim to departures only.
  const provenance = readyData ? provenanceCopyForResult(readyData) : null;

  return (
    <section aria-label={rideLabel} style={styles.card}>
      <div style={styles.header}>
        <span style={styles.eyebrow}>{rideLabel}</span>
        {readyData ? (
          <span style={styles.station}>
            {readyData.station.name}
            {readyData.station.distanceM > 0 ? (
              <span style={styles.distance}> · ~{readyData.station.distanceM} m away</span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div style={styles.destinationBlock}>
        {destinationLabel && !editingDestination ? (
          <p style={styles.destinationSet}>
            Heading to <strong>{destinationLabel}</strong>
            <button
              type="button"
              style={styles.destinationAction}
              onClick={() => {
                setDestinationDraft(destinationLabel);
                setEditingDestination(true);
              }}
            >
              Change
            </button>
            <button type="button" style={styles.destinationAction} onClick={() => saveDestination("")}>
              Clear
            </button>
          </p>
        ) : (
          <form
            style={styles.destinationForm}
            onSubmit={(event) => {
              event.preventDefault();
              saveDestination(destinationDraft);
            }}
          >
            <label style={styles.destinationLabel} htmlFor={destinationInputId}>
              {destinationLabel ? "Update destination" : "Where are you heading?"}
            </label>
            <div style={styles.destinationRow}>
              <input
                id={destinationInputId}
                type="text"
                name="destination"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="Station, postcode, or area"
                value={destinationDraft}
                onChange={(event) => setDestinationDraft(event.target.value)}
                style={styles.destinationInput}
              />
              <button type="submit" style={styles.destinationSubmit}>
                {destinationLabel ? "Update" : "Set"}
              </button>
              {destinationLabel ? (
                <button
                  type="button"
                  style={styles.destinationCancel}
                  onClick={() => {
                    setDestinationDraft(destinationLabel);
                    setEditingDestination(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <p style={styles.destinationHint}>Session only. Never saved to your profile.</p>
          </form>
        )}
      </div>

      {displayState.status === "loading" ? (
        <>
          {staticStation ? (
            <p style={styles.note}>{staticStation}</p>
          ) : null}
          <p style={styles.note}>Checking live {mode}s from near {venueName ?? "here"}…</p>
        </>
      ) : null}

      {displayState.status === "empty" ? (
        <>
          {staticStation ? (
            <p style={styles.note}>{staticStation}</p>
          ) : null}
          <p style={styles.note}>{emptyNoteForCity(cityId)}</p>
        </>
      ) : null}

      {readyData && showLondonStaticFallback(cityId, readyData) ? (
        <p style={styles.note}>
          Station from our map. Live train times unavailable until TfL responds again.
        </p>
      ) : null}

      {decision ? (
        <DecisionBlock
          decision={decision}
          mode={mode}
          provider={readyData?.provider}
          leaveBy={leaveBy}
          countdownPhrase={countdownPhrase}
          shareState={shareState}
          onShare={shareToCrew}
          venueKind={venueKind}
        />
      ) : null}

      {readyData?.departures && readyData.departures.length > 0 ? (
        <ul style={styles.list}>
          {readyData.departures.map((line) => (
            <li key={line.lineId} style={styles.row}>
              <span aria-hidden="true" style={{ ...styles.dot, background: line.colour }} />
              <span style={styles.lineName}>{line.lineName}</span>
              <span style={styles.times}>
                {line.times.join(" · ")}
                {!line.live ? <span style={styles.timetableTag}> (timetable)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {readyData && readyData.trains.length > 0 ? (
        <ul style={styles.list}>
          {readyData.trains.map((train) => (
            <li key={train.lineId} style={styles.row}>
              <span aria-hidden="true" style={{ ...styles.dot, background: train.colour }} />
              <span style={styles.lineName}>{lastServiceLineLabel(train.lineName, mode)}</span>
              <span style={styles.clock}>
                {train.clock}
                {train.pastMidnight ? <span style={styles.tomorrow}> (tomorrow)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {readyData?.nearestPubs && readyData.nearestPubs.length > 0 ? (
        <div style={styles.pubsBlock}>
          <span style={styles.eyebrow}>One more by the platform</span>
          <ul style={styles.pubList}>
            {readyData.nearestPubs.map((pub) =>
              onSelectVenue ? (
                <li key={pub.id}>
                  <button
                    type="button"
                    style={styles.pubButton}
                    onClick={() => onSelectVenue(pub.id)}
                  >
                    <span style={styles.pubName}>{pub.name}</span>
                    {typeof pub.price === "number" ? (
                      <span style={styles.pubPrice}>£{pub.price.toFixed(2)}</span>
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={pub.id} style={styles.pubPlain}>
                  <span style={styles.pubName}>{pub.name}</span>
                  {typeof pub.price === "number" ? (
                    <span style={styles.pubPrice}>£{pub.price.toFixed(2)}</span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {readyData ? <p style={styles.provenance}>{provenance}</p> : null}
    </section>
  );
}

// Inline styles keep this self-contained (the task owns no CSS file); they lean on
// the app's brass/ink/paper CSS variables so the card matches the other map panels.
const styles: Record<string, React.CSSProperties> = {
  card: {
    borderRadius: "var(--radius-sm, 8px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--panel-raised, #fbf9f2)",
    color: "var(--ink, #2a2a26)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.4,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--ink-soft, #6b726a)",
  },
  station: {
    fontWeight: 600,
  },
  distance: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  note: {
    margin: 0,
    color: "var(--ink-soft, #6b726a)",
  },
  decision: {
    margin: "4px 0 10px",
  },
  decisionLine: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
  },
  leaveBy: {
    margin: "2px 0 0",
    color: "var(--ink-soft, #6b726a)",
  },
  countdown: {
    fontVariantNumeric: "tabular-nums",
    color: "var(--ink, #2a2a26)",
  },
  shareRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  shareButton: {
    padding: "6px 12px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--panel, #f4f1e8)",
    color: "var(--ink, #2a2a26)",
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  shareError: {
    fontSize: 11,
    color: "var(--accent-risk, #b3261e)",
  },
  disruption: {
    margin: "4px 0 0",
    color: "var(--accent-risk, #b3261e)",
    fontSize: 12,
  },
  list: {
    listStyle: "none",
    margin: "0 0 10px",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
  },
  lineName: {
    flex: 1,
    minWidth: 0,
  },
  times: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  timetableTag: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  clock: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  tomorrow: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  pubsBlock: {
    marginTop: 4,
    paddingTop: 8,
    borderTop: "1px solid var(--line, #d9d4c7)",
  },
  pubList: {
    listStyle: "none",
    margin: "6px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  pubPlain: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "2px 0",
  },
  pubButton: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "4px 0",
    background: "none",
    border: "none",
    borderBottom: "1px dashed var(--line, #d9d4c7)",
    color: "var(--ink, #2a2a26)",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  pubName: {
    flex: 1,
    minWidth: 0,
  },
  pubPrice: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
    color: "var(--ink-soft, #6b726a)",
  },
  provenance: {
    margin: "8px 0 0",
    fontSize: 11,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationBlock: {
    margin: "0 0 10px",
    paddingBottom: 8,
    borderBottom: "1px solid var(--line, #d9d4c7)",
  },
  destinationSet: {
    margin: 0,
    fontSize: 12,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationAction: {
    marginLeft: 8,
    padding: 0,
    border: "none",
    background: "none",
    color: "var(--brass, #ff5a5f)",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  destinationForm: {
    margin: 0,
  },
  destinationLabel: {
    display: "block",
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  destinationInput: {
    flex: "1 1 140px",
    minWidth: 0,
    minHeight: 44,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--paper, #fff)",
    color: "var(--ink, #2a2a26)",
    font: "inherit",
    fontSize: 13,
  },
  destinationSubmit: {
    minHeight: 44,
    padding: "6px 10px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--brass, #ff5a5f)",
    color: "var(--paper, #fff)",
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  destinationCancel: {
    minHeight: 44,
    padding: "6px 8px",
    border: "none",
    background: "none",
    color: "var(--ink-soft, #6b726a)",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  destinationHint: {
    margin: "4px 0 0",
    fontSize: 10,
    color: "var(--ink-soft, #6b726a)",
  },
};
