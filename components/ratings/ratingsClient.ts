"use client";

// Client-side plumbing shared by the rating surfaces (E3):
//   • fetchRatingSummary — a microtask-batched read: every rating row mounted
//     in the same tick queues its ref, and ONE GET /api/ratings?refs=a,b,c
//     serves them all (a 30-drink menu is one request, not thirty).
//   • postRating — the write, returning the fresh summary.
//   • storedHandle / rememberHandle — the app's self-asserted identity
//     convention (localStorage `pubmax_handle`, same key as the composer,
//     comments, follows).

import type { RatingKind, RatingSummary, RatingValue } from "@/lib/ratings";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";

const HANDLE_KEY = "pubmax_handle";

export function storedHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export function rememberHandle(handle: string): void {
  if (typeof window === "undefined") return;
  const clean = handle.trim();
  if (clean) window.localStorage.setItem(HANDLE_KEY, clean);
}

type Waiter = {
  ref: string;
  resolve: (summary: RatingSummary | null) => void;
};

// One pending batch per kind; flushed on a macrotask so every row mounted in
// the same render joins the same request. Batches are capped to the API's
// 50-ref limit by chunking.
const pending: Record<RatingKind, Waiter[]> = { drink: [], venue: [] };
const scheduled: Record<RatingKind, boolean> = { drink: false, venue: false };
const BATCH_SIZE = 50;

async function flush(kind: RatingKind): Promise<void> {
  scheduled[kind] = false;
  const waiters = pending[kind].splice(0);
  if (waiters.length === 0) return;
  for (let i = 0; i < waiters.length; i += BATCH_SIZE) {
    const chunk = waiters.slice(i, i + BATCH_SIZE);
    const refs = Array.from(new Set(chunk.map((w) => w.ref)));
    let summaries: Record<string, RatingSummary> = {};
    try {
      const res = await fetch(
        `/api/ratings?kind=${kind}&refs=${encodeURIComponent(refs.join(","))}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { summaries?: Record<string, RatingSummary> };
        summaries = body.summaries ?? {};
      }
    } catch {
      // Fail-soft: every waiter resolves null → the row renders unrated.
    }
    for (const waiter of chunk) waiter.resolve(summaries[waiter.ref] ?? null);
  }
}

/** Batched summary read. Resolves null on any failure (render as unrated). */
export function fetchRatingSummary(
  kind: RatingKind,
  ref: string,
): Promise<RatingSummary | null> {
  return new Promise((resolve) => {
    pending[kind].push({ ref, resolve });
    if (!scheduled[kind]) {
      scheduled[kind] = true;
      setTimeout(() => void flush(kind), 0);
    }
  });
}

/** Cast (or re-cast) a rating. Returns the fresh summary, or throws with the
 *  server's message so the caller can show honest inline feedback. */
export async function postRating(input: {
  kind: RatingKind;
  ref: string;
  venueId?: string;
  handle: string;
  rating: RatingValue;
}): Promise<RatingSummary> {
  const res = await authedActionFetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    summary?: RatingSummary;
    error?: string;
  };
  if (!res.ok || !body.summary) {
    throw new Error(errorMessageFrom(body, "Couldn't save your rating just now."));
  }
  return body.summary;
}
