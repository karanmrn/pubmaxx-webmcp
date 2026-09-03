"use client";

// The map's "New round here" surface. A client leaf that fetches the fresh-facts
// for the active area from /api/area-news and renders them through AreaNewsList.
// It carries area it describes in state so stale data never shows against newly
// selected area. Empty successful responses render through AreaNewsList.

import { useEffect, useState } from "react";

import type { AreaNewsEntry } from "@/lib/areaNews";
import AreaNewsList from "./AreaNewsList";

type BlockState = {
  area: string;
  status: "ready" | "unavailable";
  entries: AreaNewsEntry[];
};

export default function AreaNewsBlock({
  area,
  areaLabel,
  headingId,
}: {
  /** Area slug to look up (a Night Area slug, or a borough slug). */
  area: string | null;
  /** Human-readable label for the heading. */
  areaLabel: string;
  headingId?: string;
}): React.JSX.Element | null {
  const [state, setState] = useState<BlockState | null>(null);

  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    fetch(`/api/area-news?area=${encodeURIComponent(area)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Area news request failed: ${res.status}`);
        return res.json();
      })
      .then((body: { status?: "ready" | "unavailable"; entries?: AreaNewsEntry[] } | null) => {
        if (body?.status === "unavailable") {
          setState({ area, status: "unavailable", entries: [] });
          return;
        }
        if (!Array.isArray(body?.entries)) throw new Error("Area news response was not valid.");
        const entries = body.entries;
        setState({ area, status: "ready", entries });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ area, status: "unavailable", entries: [] });
      });
    return () => controller.abort();
  }, [area]);

  if (!area || !state || state.area !== area) return null;

  return (
    <AreaNewsList
      areaLabel={areaLabel}
      entries={state.entries}
      status={state.status}
      headingId={headingId ?? "mapAreaNewsHeading"}
    />
  );
}
