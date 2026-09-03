"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import type { MissionSurface } from "@/lib/analyticsEvents";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  dismissPriceEvidenceMission,
  readDismissedMissions,
} from "@/lib/priceEvidenceMissionDismiss";
import {
  buildPriceEvidenceMissionUrl,
  dismissedVenueIds,
  readPriceEvidenceMissionWithDeadline,
  startPriceEvidenceMissionRequest,
  type PriceEvidenceMissionRead,
} from "@/lib/priceEvidenceMissionClient";
import {
  missionAnalyticsProps,
  type PriceEvidenceMission,
} from "@/lib/priceEvidenceMissions";

type PriceEvidenceMissionView =
  | { status: "idle" }
  | { status: "loading" }
  | PriceEvidenceMissionRead;

export function usePriceEvidenceMission(input: {
  venueIds: readonly string[];
  enabled: boolean;
  surface: MissionSurface;
}): {
  mission: PriceEvidenceMission | null;
  status: PriceEvidenceMissionView["status"];
  dismiss: (mission: PriceEvidenceMission) => void;
} {
  const { user, identityResolved } = useAuth();
  const signedIn = Boolean(identityResolved && user);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // Session storage is the only owner of skip state across this tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissedMissions(window.sessionStorage));
  }, []);
  const requestIds = useMemo(() => {
    const skipped = dismissedVenueIds(dismissed);
    return input.venueIds.filter((venueId) => venueId && !skipped.has(venueId));
  }, [dismissed, input.venueIds]);
  const requestUrl = useMemo(
    () => buildPriceEvidenceMissionUrl(requestIds),
    [requestIds],
  );
  const enabled = input.enabled && signedIn && Boolean(requestUrl);
  const [resolved, setResolved] = useState<{
    requestUrl: string;
    view: PriceEvidenceMissionView;
  }>({ requestUrl: "", view: { status: "idle" } });
  const generationRef = useRef(0);
  const viewedKey = useRef<string | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !requestUrl) {
      return;
    }
    // External read owns this paint. The last answer stays until this one lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({ requestUrl, view: { status: "loading" } });
    const request = startPriceEvidenceMissionRequest(
      requestUrl,
      authedActionFetch,
    );
    // The deadline may only degrade a read that is still in flight, so the
    // race settles exactly once and a mission that landed stays put.
    const read = readPriceEvidenceMissionWithDeadline(request);
    void read.settled.then((outcome) => {
      if (outcome.outcome === "abandoned") return;
      if (generation !== generationRef.current) return;
      setResolved({
        requestUrl,
        view:
          outcome.outcome === "read"
            ? outcome.read
            : { status: "degraded", mission: null },
      });
    });
    return () => {
      read.cancel();
    };
  }, [enabled, requestUrl]);

  const view: PriceEvidenceMissionView = !enabled
    ? { status: "idle" }
    : resolved.requestUrl === requestUrl
      ? resolved.view
      : { status: "loading" };
  const mission = view.status === "ready" || view.status === "degraded"
    ? view.mission
    : null;

  useEffect(() => {
    if (!mission) return;
    const key = `${input.surface}:${mission.venueId}:${mission.reason}:${mission.drinkCategory ?? ""}`;
    if (viewedKey.current === key) return;
    viewedKey.current = key;
    trackEvent("mission_viewed", missionAnalyticsProps(input.surface, mission));
  }, [input.surface, mission]);

  const dismiss = useCallback(
    (current: PriceEvidenceMission) => {
      const next = dismissPriceEvidenceMission(
        current,
        typeof window === "undefined" ? null : window.sessionStorage,
      );
      setDismissed(next);
      trackEvent(
        "mission_dismissed",
        missionAnalyticsProps(input.surface, current),
      );
    },
    [input.surface],
  );

  return { mission, status: view.status, dismiss };
}

