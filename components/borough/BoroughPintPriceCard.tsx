"use client";

import { useEffect, useState } from "react";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

type CityAreaResponse = {
  borough: string | null;
  averagePintGbp: number | null;
  asOf: string | null;
  error?: string;
};

type BoroughPintPriceCardProps = {
  boroughName: string;
  ourCheapestPrice: number | null;
};

// "MMM yyyy" — mirrors the style lib/relativeTime.ts uses for old
// timestamps, inlined here since this card needs it standalone (not as part
// of a relative-age string).
function formatCheckedDate(iso: string | null): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

/**
 * CityMCP-sourced average pint price for the borough — a small provenance-
 * labelled chip on the borough page's header. Client-fetched (CityMCP is a
 * live upstream, not baked into the static dataset build at build time) and
 * fail-soft: a missing/errored response just renders nothing, never a
 * broken chip. Always labelled "CityMCP" — never presented as our own
 * community data, since it isn't.
 */
export default function BoroughPintPriceCard({
  boroughName,
  ourCheapestPrice,
}: BoroughPintPriceCardProps) {
  const [area, setArea] = useState<CityAreaResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ borough: boroughName });
    void loadSurfaceJson<CityAreaResponse>(
      `/api/citymcp/area?${qs.toString()}`,
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(
            body &&
              typeof body === "object" &&
              "averagePintGbp" in body &&
              "borough" in body,
          ),
      },
      (body) => setArea(body),
    );
    return () => controller.abort();
  }, [boroughName]);

  if (!area || typeof area.averagePintGbp !== "number") return null;

  const checked = formatCheckedDate(area.asOf);
  const showCompare =
    typeof ourCheapestPrice === "number" &&
    ourCheapestPrice < area.averagePintGbp;

  return (
    <p className="boroughPintChip" role="status">
      <span className="boroughPintChipLabel">CityMCP</span>
      <span>
        Average pint in {boroughName}: £{area.averagePintGbp.toFixed(2)}
        {checked ? ` · checked ${checked}` : ""}
      </span>
      {showCompare ? (
        <span className="boroughPintChipCompare">
          {" "}
          · our map&rsquo;s cheapest here is £{ourCheapestPrice!.toFixed(2)}
        </span>
      ) : null}
    </p>
  );
}
