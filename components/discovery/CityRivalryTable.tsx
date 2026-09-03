"use client";

import Link from "next/link";

import type { CityRivalryEntry } from "@/lib/cityRivalry";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";

type CityRivalryTableProps = {
  entries: CityRivalryEntry[];
  caption?: string;
};

/**
 * Compact UK city energy table for Discover — community drops + curated crawls
 * + venue coverage, not a fake price catalogue. Links each city via cityMapShareUrl
 * (London stays `/map`; other cities use `/map/{id}`). City taps also persist
 * preferred-city so Map/Drop nav follow the last rivalry pick.
 */
export default function CityRivalryTable({
  entries,
  caption = "UK city energy. Demo Pint Drops, listed crawls, and venue coverage.",
}: CityRivalryTableProps) {
  if (entries.length === 0) {
    return (
      <p className="discoverEmpty" role="status">
        City energy ranks land once the packs ship.
      </p>
    );
  }

  return (
    <table className="leaderboard cityRivalry">
      <caption className="srOnly">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="leaderboardRank">
            #
          </th>
          <th scope="col">City</th>
          <th scope="col" className="leaderboardArea cityRivalryDrops">
            Drops
          </th>
          <th scope="col" className="leaderboardPriceHead cityRivalryScore">
            Energy
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={entry.cityId}>
            <td className="leaderboardRank">
              <span className="leaderboardRankNum" aria-hidden="true">
                {index + 1}
              </span>
              <span className="srOnly">Rank {index + 1}</span>
            </td>
            <th scope="row" className="leaderboardName">
              <Link
                className="cityRivalryLink"
                href={cityMapShareUrl(entry.cityId)}
                onClick={() => writePreferredCity(entry.cityId)}
              >
                <span className="leaderboardPub">{entry.displayName}</span>
                <span className="leaderboardPint">{entry.tagline}</span>
              </Link>
            </th>
            <td className="leaderboardArea cityRivalryDrops">{entry.dropCount}</td>
            <td className="leaderboardPriceHead cityRivalryScore">
              <span className="cityRivalryScoreNum">{formatScore(entry.score)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
