"use client";

// §4.10: the recap page server-renders only a privacy-safe shell. This client
// component fetches the capability-gated GET /api/plans/[id]/recap and reveals
// the full recap — route venue names, pints, the user title — ONLY when the
// server returns a member projection. A non-member (or the flag off) gets the
// preview envelope and sees the private-recap notice, never the route.

import { useEffect, useState } from "react";
import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import PubmaxxNightSeal from "@/components/brand/PubmaxxNightSeal";
import RecapShareButton from "@/components/plan/RecapShareButton";
import type { RecapView } from "@/lib/recapView";

type MemberRecap =
  | { visibility: "member"; completed: false; stopCount: number }
  | { visibility: "member"; completed: true; stopCount: number; view: RecapView; shareText: string };

type RecapResponse = { visibility: "preview" } | MemberRecap;

type LoadState = { kind: "loading" } | { kind: "preview" } | { kind: "member"; recap: MemberRecap };

function endingLine(view: RecapView): string | null {
  if (!view.ending) return null;
  switch (view.ending.kind) {
    case "food":
      return `Ended on ${view.ending.label}`;
    case "keep_going":
      return `Kept going. ${view.ending.label}`;
    default:
      return view.ending.label;
  }
}

export default function RecapDetail({ planId }: { planId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}/recap`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<RecapResponse>) : null))
      .then((body) => {
        if (!active) return;
        if (body && body.visibility === "member") setState({ kind: "member", recap: body });
        else setState({ kind: "preview" });
      })
      .catch(() => {
        if (active) setState({ kind: "preview" });
      });
    return () => {
      active = false;
    };
  }, [planId]);

  if (state.kind === "loading") {
    return <section className="recapSection" aria-busy="true" aria-label="Loading recap" />;
  }

  if (state.kind === "preview") {
    return (
      <section className="recapSection recapSection--locked" aria-label="Private recap">
        <p className="recapEmpty__body">
          This recap is private to the crew. Join the plan to see the route you walked, the pints logged, and how the
          night ended.
        </p>
        <Link className="recapEmpty__back" href={`/plan/${planId}`}>
          Back to the plan
        </Link>
      </section>
    );
  }

  const { recap } = state;
  if (!recap.completed) {
    return (
      <section className="recapEmpty" aria-label="Recap not finished">
        <h2 className="type-section-title">This night isn&rsquo;t finished yet</h2>
        <p className="recapEmpty__body">
          The recap writes itself the morning after. Finish the night and the route, the pints, and the last-train
          verdict land here.
        </p>
        <Link className="recapEmpty__back" href={`/plan/${planId}`}>
          Back to the plan
        </Link>
      </section>
    );
  }

  const { view, shareText } = recap;
  const ending = endingLine(view);
  let section = 0;
  const step = () => ({ ["--recap-step" as string]: String(section++) });

  return (
    <>
      <header className="recapHero" style={step()}>
        <PubmaxxNightSeal className="recapHero__seal" size={64} title="Night sealed" />
        <p className="type-meta recapHero__eyebrow">The morning after</p>
        <h1 className="recapHero__title type-section-title">{view.title}</h1>
        <div className="recapHero__stats" aria-label="Night at a glance">
          <span className="recapStat">
            <b>{view.stats.stopCount}</b> {view.stats.stopCount === 1 ? "stop" : "stops"}
          </span>
          {view.stats.pintCount > 0 ? (
            <span className="recapStat">
              <b>{view.stats.pintCount}</b> {view.stats.pintCount === 1 ? "pint logged" : "pints logged"}
            </span>
          ) : null}
          {view.stats.totalGbp !== null ? (
            <PriceBadge variant="current" className="recapStat--price">
              £{view.stats.totalGbp.toFixed(2)}
            </PriceBadge>
          ) : null}
        </div>
      </header>

      {view.route.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-route-title">
          <h2 id="recap-route-title" className="type-card-title recapSection__title">
            The route you walked
          </h2>
          <ol className="recapRoute">
            {view.route.map((stop) => (
              <li key={`${stop.venueId}-${stop.position}`} className="recapRoute__stop">
                <span className="recapRoute__number" aria-hidden="true">
                  {stop.position + 1}
                </span>
                <div className="recapRoute__body">
                  <span className="recapRoute__name">{stop.venueName}</span>
                  {stop.caption ? <p className="recapRoute__caption">{stop.caption}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.pints.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-pints-title">
          <h2 id="recap-pints-title" className="type-card-title recapSection__title">
            Pints logged
          </h2>
          <ul className="recapPints">
            {view.pints.map((pint, index) => (
              <li key={`${pint.venueId}-${index}`} className="recapPint">
                <div className="recapPint__body">
                  <span className="recapPint__drink">{pint.drink ?? "A pint"}</span>
                  {pint.venueName ? <span className="recapPint__venue type-meta">{pint.venueName}</span> : null}
                  {pint.note ? <p className="recapPint__note">{pint.note}</p> : null}
                </div>
                {pint.priceLabel ? (
                  <PriceBadge variant="current" className="recapPint__price">
                    {pint.priceLabel}
                  </PriceBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ending || view.guardian ? (
        <section className="recapSection recapSection--ending" style={step()} aria-label="How the night ended">
          {ending ? (
            <div className="recapEnding">
              <span className="type-meta recapEnding__label">How it ended</span>
              <p className="recapEnding__line">{ending}</p>
            </div>
          ) : null}
          {view.guardian ? (
            <div className={`recapGuardian recapGuardian--${view.guardian.tone}`}>
              <span className="type-meta recapGuardian__label">The guardian</span>
              <p className="recapGuardian__line">{view.guardian.label}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="recapFooter" style={step()}>
        <p className="recapClosing">{view.closingLine}</p>
        <div className="recapFooter__actions">
          <RecapShareButton planId={planId} shareText={shareText} />
          <Link className="recapFooter__plan" href={`/plan/${planId}`}>
            Back to the plan
          </Link>
        </div>
      </footer>
    </>
  );
}
