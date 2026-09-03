"use client";

// Choosing which pub to share, without leaving the thread.
//
// It searches the CURATED index alone (`/api/venue-search`), because a card
// promising a priced pin has to land on a pub the map actually has. A search
// that failed says so and stays open to a retry; it never reads as a city with
// no pubs by that name in it.

import { useEffect, useId, useRef, useState } from "react";

import {
  MESSAGE_VENUE_SEARCH_EMPTY_LINE,
  MESSAGE_VENUE_SEARCH_FAILED_LINE,
  MESSAGE_VENUE_SEARCH_LABEL,
  MESSAGE_VENUE_SEARCH_PLACEHOLDER,
} from "@/lib/messageAttachments";
import { discardBody } from "@/lib/responseBody";

export type PickedVenue = { id: string; name: string; area: string };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 220;

type SearchState = "idle" | "searching" | "ready" | "failed";

export default function MessageVenuePicker({
  onPick,
  onCancel,
}: {
  onPick: (venue: PickedVenue) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PickedVenue[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    // A query too short to search is settled by the keystroke that made it so
    // (see onChange), not by this effect: a synchronous setState here would run
    // the render again for a search nobody started.
    if (trimmed.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState("searching");
      void (async () => {
        try {
          const res = await fetch(`/api/venue-search?q=${encodeURIComponent(trimmed)}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            discardBody(res);
            setState("failed");
            return;
          }
          const body = (await res.json()) as {
            venues?: { id?: unknown; name?: unknown; area?: unknown }[];
          };
          const rows = Array.isArray(body.venues) ? body.venues : [];
          setHits(
            rows
              .filter(
                (row): row is { id: string; name: string; area?: string } =>
                  typeof row.id === "string" && typeof row.name === "string",
              )
              .map((row) => ({
                id: row.id,
                name: row.name,
                area: typeof row.area === "string" ? row.area : "",
              })),
          );
          setState("ready");
        } catch (err) {
          // Our own teardown is not a failure the reader should be told about.
          if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
            return;
          }
          setState("failed");
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="composerVenuePicker">
      <label htmlFor={fieldId} className="composerVenueNote">
        {MESSAGE_VENUE_SEARCH_LABEL}
      </label>
      <input
        ref={inputRef}
        id={fieldId}
        type="search"
        className="composerVenueSearch"
        value={query}
        placeholder={MESSAGE_VENUE_SEARCH_PLACEHOLDER}
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (next.trim().length < MIN_QUERY) {
            setHits([]);
            setState("idle");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />

      {state === "ready" && hits.length === 0 ? (
        <p className="composerVenueNote">{MESSAGE_VENUE_SEARCH_EMPTY_LINE}</p>
      ) : null}
      {state === "failed" ? (
        <p className="composerVenueNote" role="status">
          {MESSAGE_VENUE_SEARCH_FAILED_LINE}
        </p>
      ) : null}

      {hits.length > 0 ? (
        <ul className="composerVenueResults">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="composerVenueResult"
                onClick={() => onPick(hit)}
              >
                <span>{hit.name}</span>
                {hit.area ? <span className="composerVenueResultArea">{hit.area}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <button type="button" className="composerPendingRemove" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
