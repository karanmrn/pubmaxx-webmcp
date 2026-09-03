"use client";

// The morning brief surface (/today). A personal greeting over a stack of
// cards, mobile-first, both themes via role tokens. Most cards render from
// server-composed props (lib/todayBrief.ts); the Tube and get-there cards own
// their own location + live TfL. Every sourced claim carries its attribution,
// and every card has an honest empty/stale state rather than filler.
//
// Anything that names a time of day (the greeting, the Tube eyebrow, the picks
// empty state) takes its band from lib/dayGreeting.ts rather than hardcoding
// one, so the page never greets a viewer with somebody else's hour. No em
// dashes in any copy.
//
// Two arrows, and they mean two different things. `ExternalLink` rides a link
// that leaves the site; `ArrowRight` rides one that stays on it. Every internal
// link here used to carry the diagonal `ArrowUpRight`, which is the glyph a
// reader has learnt means "this opens somewhere else" - so "See everything on
// tonight", a link to /tonight, promised a new tab it never opened.

import Link from "next/link";
import {
  ArrowRight,
  Beer,
  CalendarClock,
  CloudSun,
  ExternalLink,
  Flame,
  Landmark,
  MapPin,
  Sun,
  Waves,
} from "lucide-react";

import { useEffect, useState } from "react";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import {
  buildDayGreeting,
  picksCardStatus,
  picksListLine,
  type DayGreeting,
  type DaySlot,
  type PicksListReadStatus,
} from "@/lib/dayGreeting";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { NIGHT_PATCHES, readRememberedArea } from "@/lib/nightPatches";
import { PLAN_INTAKE_STORAGE_KEY, parsePlanIntakeDraft } from "@/lib/planIntake";
import { resolveTonightNear } from "@/lib/tonight";
import { orderPicksNear, type TodayFact, type TonightPickDto, type WeatherBrief } from "@/lib/todayBrief";
import {
  applyTodayPersonalization,
  resolveTodayPersonalization,
} from "@/lib/todayPersonalization";

import TodayGetThereStrip from "./TodayGetThereStrip";
import TodayPintsCard from "./TodayPintsCard";
import TodayQuietPintCard from "./TodayQuietPintCard";
import TodayTubeCard from "./TodayTubeCard";
import {
  resolveTodayPintsPatchId,
  type TodayPintRow,
  type TodayPintsIndex,
} from "./todayPints";
import type { QuietPintModule } from "@/lib/quietPint";
import "./today.css";

type Props = {
  dateLabel: string;
  /** The server instant this page was composed at, so the client can rebuild the
   *  greeting after personalization without drifting to a different time band. */
  nowIso: string;
  greeting: DayGreeting;
  weather: WeatherBrief | null;
  weatherByArea: Partial<Record<NightAreaSlug, WeatherBrief | null>>;
  picks: TonightPickDto[];
  picksStatus: PicksListReadStatus;
  fact: TodayFact | null;
  pintsIndex: TodayPintsIndex;
  quietPint: QuietPintModule | null;
};

// The card's glyph follows the verdict's own venue lens, so the icon is saying
// the same thing as the words beside it rather than showing a generic sky. No
// lens (no snapshot) falls back to the neutral cloud-and-sun.
const LENS_ICON = {
  "beer-garden": Sun,
  fireplace: Flame,
  riverside: Waves,
  any: CloudSun,
} as const;

function WeatherCard({ weather }: { weather: WeatherBrief | null }) {
  const LensIcon = weather ? LENS_ICON[weather.venueLens] : CloudSun;
  return (
    <section className="todayCard" aria-labelledby="today-weather-title" data-testid="today-weather">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <LensIcon size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Drink weather</p>
          <h2 className="todayCardTitle" id="today-weather-title">
            {weather ? weather.verdictLine : "No weather verdict right now."}
          </h2>
        </div>
      </div>

      {/* Deliberately no body line. The greeting above carries the observation
          ("19C and cloudy in London") and the verdict already names the drink,
          so a "Reach for a cold lager or cider." sentence here would be the
          third telling of the same two facts. Each said once, on the surface
          that owns it. */}
      {weather ? (
        <>
          {weather.stale ? (
            <p className="todayStale" role="status">
              {weather.checkedLabel}. It may have moved on. We refresh this by hand.
            </p>
          ) : null}
          <div className="todayCardFootRow">
            <span className="todayProvenance">
              {weather.checkedLabel}
              <span aria-hidden="true"> · </span>
              via{" "}
              <a
                className="todayProvenanceLink"
                href={weather.source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {weather.source.publisher}
              </a>
            </span>
          </div>
        </>
      ) : (
        <p className="todayCardEmpty">
          No fresh read on the sky just now. Have a look out the window for this one.
        </p>
      )}
    </section>
  );
}

function PicksCard({
  picks,
  filteredPickCount,
  slot,
  picksStatus,
  cheapPint,
  cheapPintScope,
}: {
  picks: TonightPickDto[];
  filteredPickCount: number;
  slot: DaySlot;
  picksStatus: PicksListReadStatus;
  cheapPint: TodayPintRow | null;
  cheapPintScope: string | null;
}) {
  const cheapPintBlock =
    cheapPint && cheapPintScope ? (
      <div className="todayPickCheapPint" data-testid="today-picks-cheap-pint">
        <p className="todayPickCheapPintEyebrow">Cheapest listed pint {cheapPintScope}</p>
        <div className="todayPintRow">
          <Link prefetch={false} className="todayPintLink pressable" href={cheapPint.mapHref}>
            <span className="todayPintName">{cheapPint.name}</span>
            <span className="todayPintPrice">{cheapPint.priceLabel}</span>
          </Link>
        </div>
      </div>
    ) : null;

  return (
    <section
      className="todayCard"
      aria-labelledby="today-picks-title"
      data-testid="today-picks"
      data-picks-status={picksCardStatus(picksStatus, picks.length, filteredPickCount)}
    >
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <CalendarClock size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Tonight</p>
          <h2 className="todayCardTitle" id="today-picks-title">
            Top picks for tonight.
          </h2>
        </div>
      </div>

      {picks.length > 0 ? (
        <>
          <ul className="todayPicks">
            {picks.map((pick) => {
              const inner = (
                <>
                  <div className="todayPickMeta">
                    <span className="todayPickKind" data-kind={pick.kind}>
                      {pick.kindLabel}
                    </span>
                    {pick.priceGbp !== null ? (
                      <span className="todayPickPrice">£{pick.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>
                  <h3 className="todayPickTitle">{pick.title}</h3>
                  <p className="todayPickPlace">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{pick.placeName}</span>
                  </p>
                  {pick.venueNote ? (
                    <span className="todayPickDigest">{pick.venueNote}</span>
                  ) : null}
                  <span className="todayPickSource">via {pick.sourceLabel}</span>
                </>
              );
              return (
                <li key={pick.id} className="todayPick" data-kind={pick.kind}>
                  {pick.href ? (
                    pick.external ? (
                      <a
                        className="todayPickLink pressable"
                        href={pick.href}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {inner}
                        <ExternalLink size={13} aria-hidden="true" className="todayPickArrow" />
                      </a>
                    ) : (
                      <Link prefetch={false} className="todayPickLink pressable" href={pick.href}>
                        {inner}
                        <ArrowRight size={14} aria-hidden="true" className="todayPickArrow" />
                      </Link>
                    )
                  ) : (
                    <div className="todayPickLink">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {cheapPintBlock}
          <p className="todayCardFootRow">
            <Link prefetch={false} href="/tonight" className="todayCardFootLink">
              See everything on tonight
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="todayCardEmpty">
            {filteredPickCount > 0
              ? "Tonight has listings, but none match your current preferences."
              : picksListLine(picksStatus, slot)}
          </p>
          {cheapPintBlock}
          <p className="todayCardFootRow">
            <Link prefetch={false} href="/map" className="todayCardFootLink">
              Meanwhile, the map knows the cheap pints
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

/** Read and validate the resumable Plan intake without cleaning up its storage. */
function readPlanIntakeDraftReadonly() {
  if (typeof window === "undefined") return null;
  try {
    return parsePlanIntakeDraft(window.localStorage.getItem(PLAN_INTAKE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function FactCard({ fact }: { fact: TodayFact | null }) {
  return (
    <section className="todayCard" aria-labelledby="today-fact-title" data-testid="today-fact">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <Landmark size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Pub of the day</p>
          <h2 className="todayCardTitle" id="today-fact-title">
            {fact ? fact.pubName : "Still in the archive"}
          </h2>
        </div>
      </div>

      {fact ? (
        <>
          <p className="todayCardBody">{fact.fact}</p>
          <div className="todayCardFootRow">
            <span className="todayProvChip" data-provenance={fact.provenance}>
              {fact.provenanceLabel}
            </span>
            {fact.sourceRef ? (
              <a
                className="todayTextButton"
                href={fact.sourceRef}
                target="_blank"
                rel="noreferrer noopener"
              >
                View source
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="todayCardEmpty">
          Every pub of the day comes with receipts, and today&apos;s are still in
          the archive. Back tomorrow.
        </p>
      )}
    </section>
  );
}

function initialPintsView(index: TodayPintsIndex): {
  cheapPint: TodayPintRow | null;
  cheapPintScope: string | null;
} {
  const id = resolveTodayPintsPatchId(null, index);
  const pintsModule = id ? index[id] : null;
  if (!pintsModule?.rows[0]) return { cheapPint: null, cheapPintScope: null };
  return {
    cheapPint: pintsModule.rows[0],
    cheapPintScope: `in ${pintsModule.areaName}`,
  };
}

export default function TodayClient({
  dateLabel,
  nowIso,
  greeting,
  weather,
  weatherByArea,
  picks,
  picksStatus,
  fact,
  pintsIndex,
  quietPint,
}: Props) {
  const [brief, setBrief] = useState({ weather, picks: picks.slice(0, 3), filteredPickCount: 0 });
  const [pintsView, setPintsView] = useState(() => initialPintsView(pintsIndex));

  // Who the salutation may name. SSR and hydration both see nobody, then the
  // live session answers. Nothing about the layout depends on it, so its
  // arrival only ever appends a name — and a name it is not yet sure of is the
  // one thing it must never append (components/auth/useViewerHandle.ts).
  const deviceHandle = useViewerHandle() ?? "";

  // Rebuild the greeting whenever the resolved weather or the handle changes,
  // always against the SERVER instant, so the time-of-day band stays exactly
  // what was rendered. `brief.weather` is the personalized (area-resolved) read
  // when personalization has run, and the server's city-level read before that.
  const shownGreeting =
    brief.weather === weather && !deviceHandle
      ? greeting
      : buildDayGreeting({
          now: new Date(nowIso),
          weather: brief.weather,
          dateLabel,
          name: deviceHandle,
        });

  // Silent continuity (#427 seam), now resolved field-by-field. The progressive
  // intake is the only newly consumed source in this UI wave. Account and
  // device Night Profiles stay pure resolver inputs until their owning account
  // lane provides an approved read contract. localStorage remains effect-only
  // so the first paint matches SSR.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const remembered = readRememberedArea();
      const rememberedPatchId = resolveTodayPintsPatchId(remembered, pintsIndex);
      const pintsModule = rememberedPatchId ? pintsIndex[rememberedPatchId] : null;
      const hasRememberedLocality =
        remembered?.kind === "patch" && rememberedPatchId === remembered.id;
      setPintsView({
        cheapPint: pintsModule?.rows[0] ?? null,
        cheapPintScope: pintsModule
          ? hasRememberedLocality
            ? "near you"
            : `in ${pintsModule.areaName}`
          : null,
      });
      const rememberedPatch = remembered?.kind === "patch"
        ? NIGHT_PATCHES.find((patch) => patch.id === remembered.id)?.id ?? null
        : null;
      const resolved = resolveTodayPersonalization({
        progressiveIntake: readPlanIntakeDraftReadonly(),
        reviewedDevice: null,
        defaults: rememberedPatch ? { preferredPatch: rememberedPatch } : null,
      });
      const personalized = applyTodayPersonalization(
        { weather, picks, filteredPickCount: 0 },
        weatherByArea,
        resolved,
      );
      // Preserve the existing borough-memory behavior for the no-profile path.
      // Modelled profile/intake fields take precedence and never consult it.
      const near = !resolved.personalized
        ? resolveTonightNear(null, remembered)
        : null;
      setBrief(near
        ? { ...personalized, picks: orderPicksNear(personalized.picks, near.near) }
        : personalized);
    });
    return () => {
      cancelled = true;
    };
  }, [picks, weather, weatherByArea, pintsIndex]);

  return (
    <main id="main" className="todayPage" data-testid="today-screen">
      <SiteNav active="today" />

      <header className="todayHead" data-testid="today-greeting">
        <NowSegment current="day" />
        <p className="todayEyebrow">{shownGreeting.salutation}</p>
        <h1 className="todayTitle" data-weather-aware={shownGreeting.weatherAware}>
          {shownGreeting.headline}
        </h1>
        <p className="todayLede">{shownGreeting.support}</p>
      </header>

      <div className="todayStack">
        <div className="todayBriefColumn">
          <WeatherCard weather={brief.weather} />
          <TodayTubeCard slot={shownGreeting.slot} />
          <PicksCard
            picks={brief.picks}
            filteredPickCount={brief.filteredPickCount}
            slot={shownGreeting.slot}
            picksStatus={picksStatus}
            cheapPint={pintsView.cheapPint}
            cheapPintScope={pintsView.cheapPintScope}
          />
          <TodayGetThereStrip />
        </div>
        <div className="todayExploreColumn">
          <TodayPintsCard index={pintsIndex} />
          <TodayQuietPintCard module={quietPint} />
          <FactCard fact={fact} />
        </div>
      </div>

      <p className="todayFoot">
        <Link prefetch={false} href="/tonight" className="todayCardFootLink">
          Jump to tonight
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link prefetch={false} href="/plan" className="todayCardFootLink">
          Plan an outing
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link prefetch={false} href="/map" className="todayCardFootLink">
          <Beer size={14} aria-hidden="true" />
          Open the map
        </Link>
      </p>
    </main>
  );
}
