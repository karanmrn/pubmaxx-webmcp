"use client";

// Drink rating row (PRD E3): the compact star line under a drink in the venue
// Menu. Reads its summary through the batched fetch (a whole menu = one GET),
// shows the community score only past the vote floor, and lets the viewer cast
// or re-cast their own half-star vote inline. Identity is the app's
// self-asserted handle (localStorage `pubmax_handle`); with none stored, a
// small inline input appears on the first rating attempt.
//
// Colour: inherits `--rating-accent` from the surrounding category section
// when the caller passes the category accent (wine burgundy, whisky amber, …),
// defaulting to brass.

import { useEffect, useState } from "react";

import type { RatingSummary, RatingValue } from "@/lib/ratings";

import StarRating from "./StarRating";
import { fetchRatingSummary, postRating, rememberHandle, storedHandle } from "./ratingsClient";

export type DrinkRatingRowProps = {
  /** Stable drink key (the drink id — see migration 0020's drink_ref note). */
  drinkRef: string;
  drinkName: string;
  venueId?: string;
  /** Category accent colour for the stars (defaults to brass). */
  accent?: string;
};

export default function DrinkRatingRow({
  drinkRef,
  drinkName,
  venueId,
  accent,
}: DrinkRatingRowProps) {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [myRating, setMyRating] = useState<RatingValue | null>(null);
  const [handle, setHandle] = useState("");
  const [needsHandle, setNeedsHandle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const nextHandle = storedHandle();
      const result = await fetchRatingSummary("drink", drinkRef);
      if (cancelled) return;
      setHandle(nextHandle);
      if (result) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [drinkRef]);

  const rate = async (value: RatingValue) => {
    const clean = handle.trim();
    if (!clean) {
      setNeedsHandle(true);
      setError("Add a handle to rate.");
      return;
    }
    setMyRating(value);
    setError(null);
    try {
      const fresh = await postRating({ kind: "drink", ref: drinkRef, venueId, handle: clean, rating: value });
      rememberHandle(clean);
      setNeedsHandle(false);
      setSummary(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your rating just now.");
    }
  };

  return (
    <span className="drinkRatingRow">
      <StarRating
        value={myRating}
        label={`Rate ${drinkName}`}
        interactive
        size="sm"
        accent={accent}
        onRate={(value) => void rate(value)}
      />
      {summary?.shown && summary.average !== null ? (
        <span className="ratingCount">
          {summary.average.toFixed(1)} · {summary.count}
        </span>
      ) : null}
      {needsHandle ? (
        <input
          className="ratingHandleInput"
          type="text"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="your handle"
          aria-label={`Handle to rate ${drinkName} as`}
        />
      ) : null}
      {error ? (
        <span className="ratingError" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}
