import Link from "next/link";

import HandleAvatar from "@/components/profile/HandleAvatar";
import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

function countLabel(total: number): string {
  return total === 1 ? "contribution" : "contributions";
}

export default function ContributorRecord({
  board,
}: {
  board: ContributorLeaderboard;
}) {
  const thin =
    board.status === "ready" &&
    board.entries.length > 0 &&
    board.entries.length < 4;

  return (
    <section className="contributorRecord" aria-labelledby="contributor-title">
      <header className="contributorHead">
        <p className="contributorEyebrow">Public record</p>
        <h1 id="contributor-title">Contributor record</h1>
        <p className="contributorLede">
          Price logs, Visit Reports and weather Recommendations, added together.
          Only identity-backed contributions are ranked. Named posts without an
          existing public profile can stay visible elsewhere but sit outside
          this record. Hidden contributions come off the count. Legacy price
          logs without a handle are not ranked. Equal totals share a place.
        </p>
        <p className="contributorWindow">{board.window.label}</p>
      </header>

      {board.status === "degraded" ? (
        <div className="contributorState" role="status">
          <h2>Record unavailable</h2>
          <p>
            We couldn&apos;t check the full identity-backed record right now, so
            no partial totals are shown.
          </p>
        </div>
      ) : board.entries.length === 0 ? (
        <div className="contributorState">
          <h2>No identity-backed totals yet</h2>
          <p>
            Visible named posts can still sit outside this identity-backed
            record when their handle has no existing public profile. Anonymous
            price logs stay off it too.
          </p>
        </div>
      ) : (
        <>
          {thin ? (
            <p className="contributorThin">
              Early record. Visible named posts without an existing public
              profile sit outside this count.
            </p>
          ) : null}
          <ol className="contributorList">
            {board.entries.map((entry) => (
              <li className="contributorRow" key={entry.handle}>
                <span className="contributorRank" aria-label={`Rank ${entry.rank}`}>
                  {entry.rank}
                </span>
                <div className="contributorIdentity">
                  <HandleAvatar
                    handle={entry.handle}
                    avatarUrl={entry.avatarUrl}
                    className="contributorAvatar"
                    imageClassName="contributorAvatar"
                    size={36}
                  />
                  <Link href={`/u/${encodeURIComponent(entry.handle)}`}>
                    @{entry.handle}
                  </Link>
                  <dl className="contributorLanes">
                    <div>
                      <dt>Prices</dt>
                      <dd>{entry.prices}</dd>
                    </div>
                    <div>
                      <dt>Visit Reports</dt>
                      <dd>{entry.reviews}</dd>
                    </div>
                    <div>
                      <dt>Recommendations</dt>
                      <dd>{entry.recommendations}</dd>
                    </div>
                  </dl>
                </div>
                <p className="contributorTotal">
                  <strong>{entry.total}</strong>{" "}
                  <span>{countLabel(entry.total)}</span>
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
