"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import type { HistoricFilterQuery } from "@/lib/pageFilters";

const SORT_OPTIONS: { value: HistoricFilterQuery["sort"]; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "az", label: "A–Z" },
  { value: "borough", label: "By borough" },
];

function queryFor(filters: HistoricFilterQuery): string {
  const params = new URLSearchParams();
  if (filters.borough) params.set("borough", filters.borough);
  if (filters.listedOnly) params.set("listed", "1");
  if (filters.hasDate) params.set("date", "1");
  if (filters.sort !== "oldest") params.set("sort", filters.sort);
  return params.toString();
}

export default function HistoricFilters({
  boroughs,
  filters,
}: {
  boroughs: string[];
  filters: HistoricFilterQuery;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function navigate(next: HistoricFilterQuery): void {
    const query = queryFor(next);
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <section
      className="historicFilters"
      aria-label="Filter and sort historic pubs"
      aria-busy={pending}
    >
      <div className="historicField">
        <label className="historicFieldLabel" htmlFor="historic-borough">
          Borough
        </label>
        <div className="historicSelectWrap">
          <select
            id="historic-borough"
            className="historicSelect"
            value={filters.borough ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                borough: event.target.value || null,
              })
            }
          >
            <option value="">All boroughs</option>
            {boroughs.map((borough) => (
              <option key={borough} value={borough}>
                {borough}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="historicField">
        <label className="historicFieldLabel" htmlFor="historic-sort">
          Sort
        </label>
        <div className="historicSelectWrap">
          <select
            id="historic-sort"
            className="historicSelect"
            value={filters.sort}
            onChange={(event) =>
              navigate({
                ...filters,
                sort: event.target.value as HistoricFilterQuery["sort"],
              })
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="historicToggles"
        role="group"
        aria-label="Narrow the list"
      >
        <button
          type="button"
          className="historicToggle"
          data-active={filters.listedOnly}
          aria-pressed={filters.listedOnly}
          onClick={() => navigate({ ...filters, listedOnly: !filters.listedOnly })}
        >
          Listed only
        </button>
        <button
          type="button"
          className="historicToggle"
          data-active={filters.hasDate}
          aria-pressed={filters.hasDate}
          onClick={() => navigate({ ...filters, hasDate: !filters.hasDate })}
        >
          Has a date
        </button>
      </div>
    </section>
  );
}
