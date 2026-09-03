"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  streakLabel,
  type ContributionSummary,
} from "@/lib/pintContributions";
import { nightsKeptLabel, readNightsKept } from "@/lib/nightsKept";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./yourContributionsCard.css";

// The "your impact" card on the You page (feat/price-drops-v2). Fetches the
// contributor's own stats from GET /api/pint-drops/stats and renders the honest
// reward: a mapping streak, pints mapped, and where on the map they landed. It
// is deliberately self-contained (its own fetch by handle) so it can drop into
// the owner-only block of app/u/[handle]/page.tsx without threading stats through
// the whole page. Duty of care: every string here is about MAPPING prices, never
// about drinking — the reward is visible impact, not a points economy.

type Props = {
  /** The owner's handle (already known — this only renders on your own profile). */
  handle: string;
  /**
   * Show the "own your streak" account nudge (the identity-push: after your
   * first drop, offer an account so a streak survives a lost device). Passed by
   * the page when the viewer is on an unclaimed device identity.
   */
  claimNudge?: boolean;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; stats: ContributionSummary };

const MAX_BOROUGH_CHIPS = 6;

function ContributorRecordLink() {
  return (
    <Link className="contribRecordLink" href="/contributors">
      See the contributor record
    </Link>
  );
}

export default function YourContributionsCard({ handle, claimNudge = false }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [nightsLabel, setNightsLabel] = useState("");

  useEffect(() => {
    try {
      const label = nightsKeptLabel(readNightsKept(window.localStorage));
      queueMicrotask(() => setNightsLabel(label));
    } catch {
      queueMicrotask(() => setNightsLabel(""));
    }
  }, []);

  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    (async () => {
      const outcome = await loadSurfaceJson<{ stats?: ContributionSummary }>(
        `/api/pint-drops/stats?handle=${encodeURIComponent(handle)}`,
        {
          signal: controller.signal,
          validate: (body) => Boolean(body?.stats),
        },
        (body) => {
          if (!body.stats) return;
          setState({ kind: "ready", stats: body.stats });
        },
      );
      if (outcome === "failed" && !controller.signal.aborted) {
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [handle]);

  if (state.kind === "loading") {
    return (
      <section className="contribCard" aria-labelledby="contrib-title" aria-busy="true">
        <p className="contribKicker" id="contrib-title">Your contributions</p>
        <p className="contribMuted">Counting your pints…</p>
        <ContributorRecordLink />
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="contribCard" aria-labelledby="contrib-title">
        <p className="contribKicker" id="contrib-title">Your contributions</p>
        <p className="contribMuted">Couldn&apos;t load your stats right now.</p>
        <ContributorRecordLink />
      </section>
    );
  }

  const { stats } = state;
  const { streak, byBorough, pintsMapped } = stats;
  const topBoroughs = byBorough.slice(0, MAX_BOROUGH_CHIPS);
  const hasContributed = pintsMapped > 0 || streak.activeDays > 0;

  return (
    <section className="contribCard" aria-labelledby="contrib-title">
      <p className="contribKicker" id="contrib-title">Your contributions</p>

      {nightsLabel ? <p className="contribNightsKept">{nightsLabel}</p> : null}

      {!hasContributed ? (
        <p className="contribEmpty">
          Log a price at a pub and your first drop lands here. That&apos;s a real
          data point on the London map, not a point in a game.
        </p>
      ) : (
        <>
          <div className="contribStreak">
            <span className="contribStreakValue" aria-hidden="true">
              {streak.current}
            </span>
            <span className="contribStreakLabel">{streakLabel(streak)}</span>
          </div>

          <div className="contribTotals">
            <div className="contribStat">
              <span className="contribStatValue">{pintsMapped}</span>
              <span className="contribStatLabel">
                {pintsMapped === 1 ? "pint mapped" : "pints mapped"}
              </span>
            </div>
            <div className="contribStat">
              <span className="contribStatValue">{byBorough.length}</span>
              <span className="contribStatLabel">
                {byBorough.length === 1 ? "borough" : "boroughs"}
              </span>
            </div>
            {streak.longest > 0 ? (
              <div className="contribStat">
                <span className="contribStatValue">{streak.longest}</span>
                <span className="contribStatLabel">best day streak</span>
              </div>
            ) : null}
          </div>

          {topBoroughs.length ? (
            <div className="contribBoroughs">
              {topBoroughs.map((tally) => (
                <span className="contribBoroughChip" key={tally.borough}>
                  {tally.borough} <b>{tally.count}</b>
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}

      {claimNudge ? (
        <a className="contribNudge" href="#account-settings">
          Own your streak. Claim your @handle
        </a>
      ) : null}
      <ContributorRecordLink />
    </section>
  );
}
