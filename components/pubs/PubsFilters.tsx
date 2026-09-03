"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import type { ZoneSelection } from "@/lib/zones";

export type PubsFilterKey = "all" | ScrapedPubSourceId;
export type PubsFilterCounts = Record<PubsFilterKey, number>;

const FILTERS: { key: PubsFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  {
    key: "nicholsonspubs.co.uk",
    label: SCRAPED_SOURCE_LABELS["nicholsonspubs.co.uk"],
  },
  { key: "youngs.co.uk", label: SCRAPED_SOURCE_LABELS["youngs.co.uk"] },
  {
    key: "greene-king.co.uk",
    label: SCRAPED_SOURCE_LABELS["greene-king.co.uk"],
  },
  { key: "other", label: SCRAPED_SOURCE_LABELS.other },
];

function queryFor(filter: PubsFilterKey, zone: ZoneSelection): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("source", filter);
  if (zone !== "all") params.set("zone", String(zone));
  return params.toString();
}

export default function PubsFilters({
  counts,
  filter,
  zone,
  zonesPresent,
  showCounts,
}: {
  counts: PubsFilterCounts;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  zonesPresent: number[];
  showCounts: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function navigate(nextFilter: PubsFilterKey, nextZone: ZoneSelection): void {
    const query = queryFor(nextFilter, nextZone);
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <>
      <div
        className="pubsFilters"
        role="group"
        aria-label="Filter by scrape source"
        aria-busy={pending}
      >
        {FILTERS.map((item) => {
          const count = counts[item.key];
          if (item.key !== "all" && count === 0) return null;
          const selected = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              className={selected ? "pubsFilter isActive" : "pubsFilter"}
              onClick={() => navigate(item.key, zone)}
            >
              <span>{item.label}</span>
              {showCounts ? <span className="pubsFilterCount">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {zonesPresent.length > 0 ? (
        <div className="zoneChips pubsZoneChips" role="group" aria-label="Filter by fare zone">
          <button
            type="button"
            className={zone === "all" ? "zoneChip isOn" : "zoneChip"}
            aria-pressed={zone === "all"}
            onClick={() => navigate(filter, "all")}
          >
            All zones
          </button>
          {zonesPresent.map((id) => (
            <button
              key={id}
              type="button"
              className={zone === id ? "zoneChip isOn" : "zoneChip"}
              aria-pressed={zone === id}
              aria-label={`Zone ${id}${zone === id ? " (selected)" : ""}`}
              onClick={() => navigate(filter, id as ZoneSelection)}
            >
              {id}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
