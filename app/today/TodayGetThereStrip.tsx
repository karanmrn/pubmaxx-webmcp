"use client";

// Today get-there strip (card 3) — "how you'll get home tonight".
//
// Follows the TonightGetHomeStrip pattern (lib/tfl.ts via /api/last-train,
// reduced by summariseGetHome), but owns its own location prompt because the
// morning brief has no shared location state to lean on. Location is optional
// and one-shot: a rounded point (nearest ~110m, coarsenViewerPoint) leaves the device
// only to find the nearest station and last train, and is never stored.
//
// React 19 rules: the fetch fires in an effect keyed on the rounded origin,
// state settles only inside the async resolution/catch, and an AbortController
// cancels on unmount or origin change. Honest states throughout: a prompt before
// sharing, a calm line when TfL has nothing, never a fabricated time.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LocateFixed, TrainFront, X } from "lucide-react";

import DisruptionLine from "@/components/transport/DisruptionLine";
import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { summariseGetHome, type GetHomeSummary } from "@/lib/tonightGetHome";
import type { LastTrainResult } from "@/lib/tfl";

type Origin = { lat: number; lng: number };
type LocationStatus = "idle" | "requesting" | "unavailable";
type Result = { kind: "summary"; summary: GetHomeSummary } | { kind: "none" } | null;

export default function TodayGetThereStrip() {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [result, setResult] = useState<Result>(null);

  const egressPoint = origin ? coarsenViewerPoint(origin) : null;
  const lat = egressPoint?.lat ?? null;
  const lng = egressPoint?.lng ?? null;

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationStatus("idle");
      },
      () => setLocationStatus("unavailable"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }, []);

  const clearLocation = useCallback(() => {
    setOrigin(null);
    setResult(null);
    setLocationStatus("idle");
  }, []);

  useEffect(() => {
    if (lat === null || lng === null) return;
    // State settles only inside the async resolution/catch (never synchronously
    // in the effect body): the "Checking..." state is already the null default.
    const controller = new AbortController();
    void loadSurfaceJson<LastTrainResult>(
      `/api/last-train?lat=${lat}&lng=${lng}`,
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(
            body &&
              typeof body === "object" &&
              "station" in body &&
              "trains" in body,
          ),
      },
      (body) => {
        const summary = summariseGetHome(body);
        setResult(summary ? { kind: "summary", summary } : { kind: "none" });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setResult({ kind: "none" });
      }
    });
    return () => controller.abort();
  }, [lat, lng]);

  return (
    <section className="todayCard" aria-labelledby="today-getthere-title" data-testid="today-get-there">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <TrainFront size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Getting home</p>
          <h2 className="todayCardTitle" id="today-getthere-title">
            Your last train, before you commit to the night.
          </h2>
        </div>
      </div>

      {origin && result?.kind === "summary" ? (
        <div className="todayGetThere">
          <p className="todayGetThereCopy">
            <span className="todayGetThereStatus">{result.summary.statusLine}</span>{" "}
            <span>{result.summary.trainLine}</span>
          </p>
          <DisruptionLine lat={origin.lat} lng={origin.lng} />
          <div className="todayCardFootRow">
            <span className="todayProvenance">via TfL</span>
            <button type="button" className="todayTextButton" onClick={clearLocation}>
              <X size={14} aria-hidden="true" />
              Remove location
            </button>
          </div>
        </div>
      ) : origin && result?.kind === "none" ? (
        <div className="todayGetThere">
          <p className="todayCardEmpty">
            Couldn&rsquo;t find a last train near you just now. Check TfL before you head out.
          </p>
          <DisruptionLine lat={origin.lat} lng={origin.lng} />
          <div className="todayCardFootRow">
            <button type="button" className="todayTextButton" onClick={clearLocation}>
              <X size={14} aria-hidden="true" />
              Remove location
            </button>
          </div>
        </div>
      ) : origin ? (
        <p className="todayCardEmpty" role="status">
          Checking your nearest station&hellip;
        </p>
      ) : (
        <div className="todayGetThere">
          <p className="todayCardBody">
            Share your rough location once and we&rsquo;ll show the last train from your
            nearest station. It stays on this page and is never saved.
          </p>
          <button
            type="button"
            className="todayButton"
            onClick={requestLocation}
            disabled={locationStatus === "requesting"}
          >
            <LocateFixed size={15} aria-hidden="true" />
            {locationStatus === "requesting"
              ? "Finding your location…"
              : locationStatus === "unavailable"
                ? "Try location again"
                : "Share location for your last train"}
          </button>
          <span className="todaySrOnly" role="status" aria-live="polite">
            {locationStatus === "requesting"
              ? "Finding your location."
              : locationStatus === "unavailable"
                ? "Location unavailable. You can try again."
                : ""}
          </span>
        </div>
      )}
      <p className="todayCardFootRow todayNearEntry">
        <Link href="/near" className="todayCardFootLink">
          <LocateFixed size={14} aria-hidden="true" />
          Find pubs near you
        </Link>
      </p>
    </section>
  );
}
