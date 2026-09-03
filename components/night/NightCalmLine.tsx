"use client";

// One quiet line of area context for the get-home flow, backed by /api/night-calm
// (data.police.uk street-level crime, aggregated to a coarse Night Area). It is a
// reassuring guardian hint, never a warning: it renders a single plain line like
// "Busy, well-used streets" or nothing at all. It never shows counts, per-street
// detail, colours-of-alarm, or "danger" language. When the context is unavailable
// or thin, the component renders NOTHING rather than guess.

import { useEffect, useState } from "react";

import type { NightAreaSlug } from "@/lib/nightAreas";
import type { NightCalmBand } from "@/lib/nightCalm";

type CalmResponse = {
  available?: boolean;
  calm?: { band?: NightCalmBand | null; label?: string | null };
};

// State carries the area it describes so a stale line never shows against a new
// area (and so we never need a synchronous reset setState in the effect body).
type CalmState = { area: NightAreaSlug; band: NightCalmBand; label: string };

export function NightCalmLine({ area }: { area: NightAreaSlug | null }): React.JSX.Element | null {
  const [state, setState] = useState<CalmState | null>(null);

  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    fetch(`/api/night-calm?area=${encodeURIComponent(area)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: CalmResponse | null) => {
        const band = body?.calm?.band ?? null;
        const label = body?.calm?.label ?? null;
        setState(body?.available && band && label ? { area, band, label } : null);
      })
      .catch(() => {
        // Fail silent: a missing calm hint is simply an absent line, never an error.
      });
    return () => controller.abort();
  }, [area]);

  if (!area || !state || state.area !== area) return null;

  return (
    <span className="nightCard__calm" data-band={state.band}>
      <span className="nightCard__calmDot" data-band={state.band} aria-hidden="true" />
      {state.label}
    </span>
  );
}

export default NightCalmLine;
