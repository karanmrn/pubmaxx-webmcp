import Link from "next/link";

import type { LeagueRow } from "@/lib/pintIndex";
import { formatPrice } from "@/lib/venues";

/**
 * The borough league table, shared by the live Index and every dated edition
 * so a reader comparing this month with last month is reading one layout and
 * one set of rules, not two that drifted apart.
 *
 * The row ORDER is the caller's: cheapest-first is the default everywhere, and
 * the dearest-end view passes the same rows the other way round. `highlight`
 * says which column that ordering is ranked on, and does two things with it.
 * That column is set in bold, and it sits first among the price columns.
 *
 * That second part is not decoration. The table is wider than a phone and
 * scrolls inside its own container, so on a 390px screen a reader sees the rank,
 * the borough and the first two price columns and nothing else. A table ranked
 * on a figure that has scrolled out of sight is unreadable, whatever it says in
 * the caption.
 */

type PriceColumn = { key: "average" | "dearest"; label: string; value: (row: LeagueRow) => number };

const AVERAGE: PriceColumn = { key: "average", label: "Average", value: (row) => row.averageGbp };
const DEAREST: PriceColumn = { key: "dearest", label: "Dearest", value: (row) => row.maxGbp };

export default function PintIndexLeagueTable({
  rows,
  caption,
  highlight = "average",
}: {
  rows: readonly LeagueRow[];
  caption: string;
  highlight?: "average" | "dearest";
}) {
  // Cheapest always sits between them: it is the one column neither view ranks
  // on, and keeping it in the middle means only the two ends ever move.
  const [lead, trail] = highlight === "dearest" ? [DEAREST, AVERAGE] : [AVERAGE, DEAREST];
  const priceColumns = [lead, { key: "cheapest" as const, label: "Cheapest", value: (row: LeagueRow) => row.minGbp }, trail];

  return (
    <div className="pintIndexTableWrap">
      <table className="pintIndexTable">
        <caption className="srOnly">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="pintIndexNum">#</th>
            <th scope="col">Borough</th>
            {priceColumns.map((column) => (
              <th scope="col" className="pintIndexNum" key={column.key}>{column.label}</th>
            ))}
            <th scope="col" className="pintIndexNum">Eligible pubs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.slug}>
              <td className="pintIndexNum pintIndexRank">{index + 1}</td>
              <th scope="row">
                <Link href={`/borough/${row.slug}`} className="pintIndexBoroughLink">{row.name}</Link>
              </th>
              {priceColumns.map((column) => (
                <td
                  key={column.key}
                  className={column.key === highlight ? "pintIndexNum pintIndexRanked" : "pintIndexNum"}
                >
                  {formatPrice(column.value(row))}
                </td>
              ))}
              <td className="pintIndexNum">{row.pubCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
