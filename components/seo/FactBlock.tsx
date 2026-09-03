import type { ReactElement } from "react";

import { formatPrice } from "@/lib/venues";
import {
  factBlockSentences,
  hasFactData,
  type PintFactStats,
} from "@/lib/pintFacts";

// Server-rendered fact block (Wave S3.1): extractable prose + a small stat table
// derived entirely from the area's tracked pint prices. Renders NOTHING when the
// area has no priced pub (honest — no invented figures). All numbers come from
// PintFactStats; the last prose line is a dated observation window, never "live".

export default function FactBlock({
  stats,
  monthYear,
  observedDate,
  headingId,
  title,
}: {
  stats: PintFactStats;
  monthYear: string;
  observedDate: string;
  headingId: string;
  title: string;
}): ReactElement | null {
  if (!hasFactData(stats)) return null;

  const sentences = factBlockSentences(stats, { monthYear, observedDate });
  // The final sentence is the provenance/observation-window stamp.
  const stampIndex = sentences.length - 1;

  return (
    <section className="factBlock" aria-labelledby={headingId}>
      <h2 id={headingId} className="factBlockTitle">
        {title}
      </h2>
      <div className="factBlockProse">
        {sentences.map((sentence, index) => (
          <p
            key={sentence}
            className={index === stampIndex ? "factBlockStamp" : undefined}
          >
            {sentence}
          </p>
        ))}
      </div>
      <table className="factStatTable">
        <caption>Tracked pint prices in {stats.name}</caption>
        <tbody>
          <tr>
            <th scope="row">Average pint</th>
            <td>{formatPrice(stats.averageGbp)}</td>
          </tr>
          <tr>
            <th scope="row">
              Cheapest pint
              {stats.minPubName ? ` · ${stats.minPubName}` : ""}
            </th>
            <td>{formatPrice(stats.minGbp)}</td>
          </tr>
          {stats.maxGbp !== null &&
          stats.minGbp !== null &&
          stats.maxGbp > stats.minGbp ? (
            <tr>
              <th scope="row">
                Dearest tracked pint
                {stats.maxPubName ? ` · ${stats.maxPubName}` : ""}
              </th>
              <td>{formatPrice(stats.maxGbp)}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Tracked pubs</th>
            <td>{stats.pubCount}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
