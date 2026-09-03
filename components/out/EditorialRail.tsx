"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_DEGRADED_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_RAIL_TITLE,
  EDITORIAL_STALE_LINE,
  editorialOglAttributionForSource,
  editorialSnapshotIsStale,
  editorialThisWeekItems,
  editorialViaChip,
  type EditorialSnapshot,
} from "@/lib/editorial";
import { loadEditorialSnapshot } from "@/lib/editorialLoader";
import { OUT_MAP_WAY, OUT_RETRY_LABEL } from "@/lib/out/outStatus";
import EmptyState from "@/components/EmptyState";

import "./editorialRail.css";

export function EditorialRailView({
  snapshot,
  now,
  onRetry,
}: {
  snapshot: EditorialSnapshot;
  now?: number;
  onRetry: () => void;
}) {
  const stale = editorialSnapshotIsStale(snapshot, now);
  const items = stale ? [] : editorialThisWeekItems(snapshot, now);
  const empty = items.length === 0;
  const statusLine =
    snapshot.status === "degraded"
      ? empty
        ? EDITORIAL_DEGRADED_EMPTY_LINE
        : EDITORIAL_DEGRADED_LINE
      : stale
        ? EDITORIAL_STALE_LINE
      : empty
        ? EDITORIAL_EMPTY_LINE
        : null;

  return (
    <section className="editorialRail" aria-labelledby="editorial-rail-heading">
      <h2 id="editorial-rail-heading" className="editorialRailTitle">
        {EDITORIAL_RAIL_TITLE}
      </h2>
      {statusLine && empty ? (
        // Nothing to read this week is still a night out, and the pubs are
        // always there. A bare sentence under the heading was a dead end.
        <EmptyState
          className="emptyState--flush"
          title={statusLine}
          actionTone="accent"
          action={
            snapshot.status === "degraded" ? (
              <button type="button" onClick={onRetry}>
                {OUT_RETRY_LABEL}
              </button>
            ) : (
              <Link prefetch={false} href={OUT_MAP_WAY.href}>
                {OUT_MAP_WAY.label}
              </Link>
            )
          }
        />
      ) : statusLine ? (
        <p className="editorialRailStatus">{statusLine}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="editorialRailList">
          {items.map((item) => {
            const ogl = editorialOglAttributionForSource(item.source_id);
            return (
              <li key={item.canonical_url} className="editorialRailItem">
                <a
                  className="editorialRailLink"
                  href={item.canonical_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.title}
                </a>
                {item.excerpt ? <p className="editorialRailExcerpt">{item.excerpt}</p> : null}
                <p className="editorialRailCredit">
                  <span className="editorialRailChip">{editorialViaChip(item.attribution_label)}</span>
                  {ogl ? (
                    <a
                      className="editorialRailOgl"
                      href={ogl.url}
                      rel="license noopener noreferrer"
                      target="_blank"
                    >
                      {ogl.label}
                    </a>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default function EditorialRail() {
  const [snapshot, setSnapshot] = useState<EditorialSnapshot | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadEditorialSnapshot().then((result) => {
      if (!cancelled) setSnapshot(result);
    });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  function retry() {
    setSnapshot(null);
    setLoadAttempt((attempt) => attempt + 1);
  }

  if (!snapshot) {
    return (
      <section
        className="editorialRail"
        aria-labelledby="editorial-rail-heading"
        aria-busy="true"
      >
        <h2 id="editorial-rail-heading" className="editorialRailTitle">
          {EDITORIAL_RAIL_TITLE}
        </h2>
        <p className="editorialRailLoading">Loading picks</p>
      </section>
    );
  }

  return <EditorialRailView snapshot={snapshot} onRetry={retry} />;
}
