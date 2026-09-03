// @vitest-environment jsdom

import { act, createElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import type { CrawlUrlState } from "@/lib/crawlUrl";
import { initialFilters, type Filters } from "@/lib/venues";

function mapState(query: string): CrawlUrlState {
  const filters: Filters = { ...initialFilters, query };
  return {
    mode: "suggest",
    filters,
    builtIds: [],
    selectedVenueId: "",
  };
}

function Harness({ query, pending }: { query: string; pending: boolean }) {
  const state = useMemo(() => mapState(query), [query]);
  useCrawlUrlSync(state, false, pending);
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/map?crawl=victorian-soho");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("curated crawl URL hydration hold", () => {
  it("keeps crawl identity when map state changes before hydration", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "Camden", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "Brixton", pending: true }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).toContain("crawl=victorian-soho");
    expect(window.location.search).toContain("q=Brixton");
  });

  it("removes crawl identity after hydration ends without a match", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "Camden", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "Brixton", pending: false }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).not.toContain("crawl=");
    expect(window.location.search).toContain("q=Brixton");
  });

  it("removes an unmatched crawl identity even without a state edit", async () => {
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: true }));
    });
    await act(async () => {
      root.render(createElement(Harness, { query: "", pending: false }));
    });
    act(() => vi.advanceTimersByTime(300));

    expect(window.location.search).toBe("");
  });
});
