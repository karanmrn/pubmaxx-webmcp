"use client";

// Everything the Tonight list says ABOUT its own read, lifted out of
// TonightClient whole: the wait, the failed read, the lane that answered short
// beside the cards, and the quiet night.
//
// A wait is a skeleton, never a sentence, because a sentence about waiting is
// read as a claim about the city. Presentation only — the status, the note and
// whether the note may offer a retry are all decided before they get here.

import Link from "next/link";
import { RefreshCw } from "lucide-react";

import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import {
  TONIGHT_WHATS_ON_FAILED_LINE,
  type TonightListingsStatus,
} from "@/lib/tonightOutListings";

export default function TonightListingsNotice({
  status,
  note,
  noteOffersRetry,
  emptyLead,
  onRetry,
}: {
  status: TonightListingsStatus;
  /** Names a lane that could not answer, or null when both were fine. */
  note: string | null;
  noteOffersRetry: boolean;
  /** The sentence a night with no rows gets, already scoped to the lanes that answered. */
  emptyLead: string;
  onRetry: () => void;
}) {
  const loading = status === "idle";
  const errored = status === "error";
  const empty = status === "empty";

  return (
    <>
      {loading ? <ListingsSkeleton /> : null}

      {errored ? (
        <div className="tonightStatus tonightStatusError">
          <p role="status">{note ?? TONIGHT_WHATS_ON_FAILED_LINE}</p>
          <button type="button" className="tonightRetry" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" />
            Retry listings
          </button>
        </div>
      ) : null}

      {!errored && !loading && note ? (
        <div
          className="tonightStatus tonightStatusNote"
          data-tonight-listings-note="partial"
        >
          <p role="status">{note}</p>
          {noteOffersRetry ? (
            <button type="button" className="tonightRetry" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              Retry listings
            </button>
          ) : null}
        </div>
      ) : null}

      {empty ? (
        <p className="tonightStatus" role="status">
          {emptyLead}{" "}
          <Link href="/map" className="tonightStatusLink">
            The map still knows where the cheap pints are
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
