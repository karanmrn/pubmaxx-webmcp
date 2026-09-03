// "A quiet pint" card: heritage-cited pubs that also read as quiet right now,
// for the calmer cohort the youth-skewing surfaces under-serve. Hosted on
// /today and /tonight from the same server compose (lib/quietPint over the
// cited historic-pub set); this component only renders it, so there is no
// client fetch and the first paint is deterministic. Fail-soft: a null module
// renders nothing.
//
// Follows /today's card idiom exactly (the #528 Tube/pints cards). The cited
// heritage line does the selling; the copy never markets at the reader. The
// quiet indicator is the app's honest register ("Usually quiet on a Tuesday"),
// and every cited claim carries its source, like Pub of the Day. No em dashes.

import Link from "next/link";
import { ArrowRight, ExternalLink, Wine } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import type { QuietPintModule } from "@/lib/quietPint";

import "./quietPintCard.css";

type Props = { module: QuietPintModule | null };

export default function TodayQuietPintCard({ module }: Props) {
  if (!module || module.rows.length === 0) return null;

  return (
    <section
      className="todayCard"
      aria-labelledby="today-quiet-pint-title"
      data-testid="today-quiet-pint"
    >
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <Wine size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">For a quieter pint</p>
          <h2 className="todayCardTitle" id="today-quiet-pint-title">
            A quiet pint, and a bit of history.
          </h2>
        </div>
      </div>

      <ul className="quietPintList">
        {module.rows.map((row) => (
          <li key={row.id} className="quietPintRow">
            <Link className="quietPintLink pressable" href={row.mapHref}>
              <span className="quietPintTop">
                <span className="quietPintName">{row.name}</span>
                {row.priceLabel ? (
                  <span className="quietPintPrice">{row.priceLabel}</span>
                ) : null}
              </span>
            </Link>
            <div className="quietPintHeritage">
              <ProseDisclosure text={row.heritageLine} />
            </div>
            <div className="quietPintFoot">
              {row.gradeLabel ? (
                <span className="quietPintGrade">{row.gradeLabel}</span>
              ) : null}
              {row.eraLabel ? (
                <span className="quietPintEra">{row.eraLabel}</span>
              ) : null}
              <span className="quietPintQuiet">{row.quietLabel}</span>
              <span className="todayProvChip">{row.provenanceLabel}</span>
              {row.sourceRef ? (
                <a
                  className="quietPintSource"
                  href={row.sourceRef}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  via {row.sourceLabel}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <span className="quietPintSource">via {row.sourceLabel}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="todayCardFootRow">
        <span className="todayProvenance">
          Quiet reads the usual pattern for the hour, not the door.
        </span>
        <Link href="/historic" className="todayTextButton">
          More historic pubs
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
