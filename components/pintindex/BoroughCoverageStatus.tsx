"use client";

import Link from "next/link";

import {
  boroughCoverageMapHref,
  boroughCoverageStatusCopy,
  type BoroughCoverageInput,
} from "@/lib/boroughCoverageStatus";

import "./boroughCoverageStatus.css";

/**
 * Status strip for seed-borough corroborated coverage. Status, not a game:
 * no streaks, no ranks, no stranger feed.
 */
export default function BoroughCoverageStatus({
  rows,
}: {
  rows: BoroughCoverageInput[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="boroughCoverage" aria-labelledby="boroughCoverageHeading">
      <h2 id="boroughCoverageHeading" className="boroughCoverageTitle">
        Borough coverage
      </h2>
      <p className="boroughCoverageDek">
        These lines count corroborated people-logged pints only. Grey pins
        still mean we do not yet have the second voice.
      </p>
      <ul className="boroughCoverageList">
        {rows.map((row) => (
          <li key={row.slug} className="boroughCoverageRow">
            <p className="boroughCoverageCopy">{boroughCoverageStatusCopy(row)}</p>
            <Link className="boroughCoverageLink" href={boroughCoverageMapHref(row.mapQuery)}>
              Open on the map
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
