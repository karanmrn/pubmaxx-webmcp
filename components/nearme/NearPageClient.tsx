"use client";

import { Suspense, useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { trackEvent } from "@/lib/analytics";
import {
  clearPosterLandingSession,
  isPosterLandingSrc,
} from "@/lib/posterLanding";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import {
  NEAR_MODE_QUERY,
  parseNearModeParam,
  resolveNearMode,
  shouldSwitchNearMode,
  type NearMode,
} from "@/lib/nearDesk";
import {
  readRememberedNearMode,
  subscribeRememberedNearMode,
  writeRememberedNearMode,
} from "@/lib/nearModePreference";
import { resolveNightPatch } from "@/lib/nightPatches";

import NearDeskNow from "./NearDeskNow";
import NearMeNow from "./NearMeNow";
import NearModeSwitch from "./NearModeSwitch";
import PosterLandingNote from "./PosterLandingNote";
import "./nearPage.css";

export function resolveNearAutoLocate(
  searchParams: Pick<URLSearchParams, "get">,
): boolean {
  return searchParams.get("locate") === "1";
}

function NearPageBody() {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const preferredCityResolved = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const patchParam = searchParams.get("patch");
  const initialPatchId = resolveNightPatch(patchParam)?.id ?? null;
  const autoLocate = resolveNearAutoLocate(searchParams);
  const rememberedMode = useSyncExternalStore(
    subscribeRememberedNearMode,
    readRememberedNearMode,
    () => null,
  );
  const modeResolved = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const modeParam = searchParams.get(NEAR_MODE_QUERY);
  const explicitMode = parseNearModeParam(modeParam);
  // Pint is what an unresolved device answers, so the default /near still
  // server-renders the pint surface and the switch above it. A remembered
  // Desk swaps in once the browser answers.
  const mode: NearMode = explicitMode
    ?? (modeResolved ? resolveNearMode(null, rememberedMode) : "pint");

  const setMode = useCallback((next: NearMode) => {
    if (!shouldSwitchNearMode(mode, next)) return;
    writeRememberedNearMode(next);
    trackEvent("near_mode_switched", { mode: next });
    if (!pathname) return;
    try {
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      params.set(NEAR_MODE_QUERY, next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    } catch {
      // URL sync is best-effort — the remembered mode still stands.
    }
  }, [mode, pathname, router]);

  // Mount-only: a fresh /near load without src=poster must not inherit a stale
  // poster session from an earlier scan in the same tab.
  useEffect(() => {
    if (!isPosterLandingSrc(searchParams.get("src"))) {
      clearPosterLandingSession();
    }
    // Mount-only by contract: later query changes must not clear this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="nmnPage">
      {/* Standard app chrome (journey audit P0): same floating SiteNav pill as
          every other app page. /near is not a primary-nav destination, so no
          active key is set (Map stays unlit). */}
      <SiteNav />
      <main id="main" className="nmnPageBody">
        {/* Physical QR arrival (PLG Wave 2): one honest orientation line when
            the drinker scanned a bar poster into /near?src=poster. */}
        <PosterLandingNote src={searchParams.get("src")} />
        <NearModeSwitch value={mode} onChange={setMode} />
        {/* Idle-first on /near so patch chips are reachable without granting
            location. Shareable ?patch= deep links answer immediately. */}
        {mode === "desk" ? (
          <NearDeskNow
            autoLocate={preferredCityResolved && autoLocate}
            initialPatchId={initialPatchId}
            syncPatchToUrl
          />
        ) : (
          <NearMeNow
            cityId={cityId}
            autoLocate={preferredCityResolved && autoLocate}
            initialPatchId={initialPatchId}
            syncPatchToUrl
            allowVenueAcceptance
            showPriceTrust
          />
        )}
      </main>
    </div>
  );
}

export default function NearPageClient() {
  return (
    <Suspense fallback={<div className="nmnPage" aria-busy="true" />}>
      <NearPageBody />
    </Suspense>
  );
}
