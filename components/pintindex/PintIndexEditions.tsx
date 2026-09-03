import Link from "next/link";

import { pintIndexMonthLabel, type ArchivedPintIndexSnapshot } from "@/lib/pintIndexArchive";

/**
 * The dated editions, newest first. This is the citable half of the Index: a
 * link to one of these still means in a year what it meant the day it was
 * written, because the file behind it is frozen and any change to it arrives
 * as a numbered, dated correction rather than a rewrite.
 */
export default function PintIndexEditions({
  editions,
  current = null,
}: {
  editions: ArchivedPintIndexSnapshot[];
  current?: string | null;
}) {
  if (editions.length === 0) return null;

  return (
    <ul className="pintIndexBoroughLinks" aria-label="Dated editions of the London Pint Index">
      {editions.map((edition) => {
        const label = pintIndexMonthLabel(edition.archive.month);
        const corrected = edition.archive.revision > 1;
        if (edition.archive.month === current) {
          return (
            <li key={edition.archive.month}>
              <span aria-current="page" className="pintIndexEditionCurrent">
                {label}
                {corrected ? ` (revision ${edition.archive.revision})` : ""}
              </span>
            </li>
          );
        }
        return (
          <li key={edition.archive.month}>
            <Link href={`/pint-index/${edition.archive.month}`}>
              {label}
              {corrected ? ` (revision ${edition.archive.revision})` : ""}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
