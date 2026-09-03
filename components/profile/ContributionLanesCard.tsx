"use client";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { authedActionFetch } from "@/lib/authedFetch";
import { trackEvent } from "@/lib/analytics";
import { discardBody } from "@/lib/responseBody";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import "./yourContributionsCard.css";

// The wider record on the You page: visit reports and recommendations beside
// the price-trust measures, for a fresh owner who has only ever seen pint drops
// (YourContributionsCard). Reads GET /api/profiles/[handle]/lane-stats - a
// narrow projection of public_contributor_leaderboard(), never the raw tables -
// so this card can never show a back-dated count. "Visit Reports" matches the
// term the public contributor record already uses
// (components/contributors/ContributorRecord.tsx); this card never says
// "reviews".
//
// ONE number per idea: how many prices this account logged is
// `observationsLogged` from GET /api/price-impact alone. The lane-stats price
// figure is derived differently (handle-keyed, post-claim), so printing both
// put two counts of the same thing side by side.

type Props = {
  /** The owner's handle (already known - this only renders on your own profile). */
  handle: string;
};

export type ContributionLaneStats = {
  status: "ready" | "degraded";
  handle: string;
  prices?: number;
  reviews?: number;
  recommendations?: number;
  total?: number;
};

export type PriceTrustImpactStats = {
  status: "ready" | "degraded";
  observationsLogged?: number;
  pricesTrustedNow?: number;
  lifetimeTrustUnlocks?: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; stats: ContributionLaneStats };

export type ContributionLanesCardState = State;

type ImpactState =
  | { kind: "loading" }
  | { kind: "degraded" }
  | { kind: "ready"; stats: PriceTrustImpactStats };

type ContentProps = {
  state: ContributionLanesCardState;
  impact?: ImpactState;
};

function measureLabel(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function ContributionLanesCardContent({ state, impact }: ContentProps) {
  if (state.kind === "loading") {
    return (
      <section
        id="contribution-impact"
        className="contribCard"
        aria-labelledby="contrib-lanes-title"
        aria-busy="true"
      >
        <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>
        <p className="contribMuted">Counting the rest of your record…</p>
      </section>
    );
  }

  if (state.kind === "error" || state.stats.status === "degraded") {
    return (
      <section
        id="contribution-impact"
        className="contribCard"
        aria-labelledby="contrib-lanes-title"
      >
        <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>
        <p className="contribMuted">Couldn&apos;t load the rest of your record right now.</p>
      </section>
    );
  }

  const { stats } = state;
  const prices = stats.prices ?? 0;
  const reviews = stats.reviews ?? 0;
  const recommendations = stats.recommendations ?? 0;
  const hasContributed = prices > 0 || reviews > 0 || recommendations > 0;

  return (
    <section
      id="contribution-impact"
      className="contribCard"
      aria-labelledby="contrib-lanes-title"
    >
      <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>

      {!hasContributed ? (
        <p className="contribEmpty">
          No prices, visit reports, or recommendations yet. Write up a pub or
          point mates to a good one and it lands here too.
        </p>
      ) : (
        <div className="contribTotals">
          <div className="contribStat">
            <span className="contribStatValue">{reviews}</span>
            <span className="contribStatLabel">
              {reviews === 1 ? "visit report" : "visit reports"}
            </span>
          </div>
          <div className="contribStat">
            <span className="contribStatValue">{recommendations}</span>
            <span className="contribStatLabel">
              {recommendations === 1 ? "recommendation" : "recommendations"}
            </span>
          </div>
        </div>
      )}

      {impact?.kind === "ready" && impact.stats.status === "ready" ? (
        <div className="contribTotals" data-testid="price-trust-impact">
          <div className="contribStat">
            <span className="contribStatValue">{impact.stats.observationsLogged ?? 0}</span>
            <span className="contribStatLabel">
              {measureLabel(
                impact.stats.observationsLogged ?? 0,
                "observation logged",
                "observations logged",
              )}
            </span>
          </div>
          <div className="contribStat">
            <span className="contribStatValue">{impact.stats.pricesTrustedNow ?? 0}</span>
            <span className="contribStatLabel">
              {measureLabel(
                impact.stats.pricesTrustedNow ?? 0,
                "price trusted now",
                "prices trusted now",
              )}
            </span>
          </div>
          <div className="contribStat">
            <span className="contribStatValue">{impact.stats.lifetimeTrustUnlocks ?? 0}</span>
            <span className="contribStatLabel">
              {measureLabel(
                impact.stats.lifetimeTrustUnlocks ?? 0,
                "lifetime trust unlock",
                "lifetime trust unlocks",
              )}
            </span>
          </div>
        </div>
      ) : null}

      {impact?.kind === "degraded" ||
      (impact?.kind === "ready" && impact.stats.status === "degraded") ? (
        <p className="contribMuted">Couldn&apos;t load your price trust record right now.</p>
      ) : null}

      <Link className="contribRecordLink" href="/contributors">
        See the contributor record
      </Link>
    </section>
  );
}

export default function ContributionLanesCard({ handle }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [impact, setImpact] = useState<ImpactState>({ kind: "loading" });
  const trackedImpact = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#contribution-impact") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("contribution-impact")?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    (async () => {
      const outcome = await loadSurfaceJson<{ stats?: ContributionLaneStats }>(
        `/api/profiles/${encodeURIComponent(handle)}/lane-stats`,
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

  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authedActionFetch("/api/price-impact", {
          signal: controller.signal,
        });
        if (!res.ok) {
          discardBody(res);
          if (!controller.signal.aborted) setImpact({ kind: "degraded" });
          return;
        }
        const body = (await res.json()) as PriceTrustImpactStats;
        if (controller.signal.aborted) return;
        if (body.status === "degraded") {
          setImpact({ kind: "degraded" });
          return;
        }
        if (body.status !== "ready") {
          setImpact({ kind: "degraded" });
          return;
        }
        setImpact({ kind: "ready", stats: body });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!controller.signal.aborted) setImpact({ kind: "degraded" });
      }
    })();
    return () => controller.abort();
  }, [handle]);

  useEffect(() => {
    if (trackedImpact.current) return;
    if (state.kind === "loading") return;
    trackedImpact.current = true;
    trackEvent("mission_impact_opened", { surface: "profile" });
  }, [state.kind]);

  return <ContributionLanesCardContent state={state} impact={impact} />;
}
