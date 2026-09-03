// The source table is the fence between "we did not harvest this" and "we did
// not notice this". Every source carries a decision, and every refusal carries
// the rule and the day it was checked.

import { describe, expect, it } from "vitest";

import {
  allowedHarvestSources,
  contextDevEventSources,
  HARVEST_SKIP_REASONS,
  HARVEST_SOURCES,
  harvestSource,
  harvestSourcesOfKind,
  isHarvestableOperatorUrl,
} from "@/lib/harvest/sourcePolicy";
import { createHarvestReporter, countDrops, harvestShortfallLines, summariseHarvestRun } from "@/lib/harvest/runReport";
import {
  COMMON_FETCH_GAP_MS,
  COMMON_SITEMAP_URL,
  COMMON_SOURCE,
} from "../scripts/whatson/commonRefresh.mjs";

describe("every source is a decision with evidence", () => {
  it("gives every source a unique id and an http(s) provenance url", () => {
    const ids = HARVEST_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of HARVEST_SOURCES) {
      expect(source.label.length).toBeGreaterThan(0);
      expect(() => new URL(source.url)).not.toThrow();
      expect(new URL(source.url).protocol).toMatch(/^https?:$/);
    }
  });

  it("records evidence and a checked date on every access decision", () => {
    for (const source of HARVEST_SOURCES) {
      expect(source.access.evidence.length).toBeGreaterThan(20);
      expect(source.access.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("names a known reason on every refusal", () => {
    for (const source of HARVEST_SOURCES) {
      if (source.access.allowed) continue;
      expect(HARVEST_SKIP_REASONS).toContain(source.access.reason);
    }
  });

  it("allows a source that owns nothing it publishes only as a named exception", () => {
    for (const source of HARVEST_SOURCES) {
      if (source.firstParty || !source.access.allowed) continue;
      expect(source.nonFirstPartyException?.length ?? 0).toBeGreaterThan(20);
    }
    for (const source of allowedHarvestSources("chain-deals")) {
      expect(source.firstParty).toBe(true);
    }
  });

  it("binds the Common reader to its own register entry", () => {
    // The register is the permission, so the crawler may not read a host, or at
    // a rate, the table does not carry. Both halves are the running values.
    const common = harvestSource("common-social-posts");
    expect(common?.access.allowed).toBe(true);
    expect(common?.url).toBe(COMMON_SITEMAP_URL);
    expect(common?.label).toBe(COMMON_SOURCE.label);
    expect((common?.crawlDelaySeconds ?? 0) * 1000).toBeLessThanOrEqual(COMMON_FETCH_GAP_MS);
    expect(isHarvestableOperatorUrl(COMMON_SITEMAP_URL)).toBe(true);
  });

  it("keeps Skiddle refused on its own commercial terms, not on robots", () => {
    const skiddle = harvestSource("skiddle-listings");
    expect(skiddle?.access.allowed).toBe(false);
    if (skiddle?.access.allowed === false) {
      expect(skiddle.access.reason).toBe("terms-forbid-commercial-use");
    }
  });

  it("finds sources by kind", () => {
    expect(harvestSourcesOfKind("chain-deals").length).toBeGreaterThan(0);
    expect(harvestSourcesOfKind("venue-events").length).toBeGreaterThan(0);
    expect(harvestSource("nope")).toBeUndefined();
  });

  it("keeps Context.dev on FIRST-PARTY venue-events pages only", () => {
    const pages = contextDevEventSources();
    expect(pages.some((source) => source.id === "fullers-event-finder-events")).toBe(true);
    expect(pages.every((source) => source.firstParty)).toBe(true);
    expect(allowedHarvestSources("venue-events").some((source) => source.id === "common-social-posts")).toBe(true);
    expect(pages.some((source) => source.id === "common-social-posts")).toBe(false);
  });
});

describe("a venue's own site is harvestable; a refused host wearing its name is not", () => {
  it("accepts an ordinary operator site", () => {
    expect(isHarvestableOperatorUrl("https://www.arnosarms.co.uk/")).toBe(true);
  });

  it("refuses a host the policy already refused", () => {
    expect(isHarvestableOperatorUrl("https://www.skiddle.com/whats-on/London/")).toBe(false);
    expect(isHarvestableOperatorUrl("https://dice.fm/browse/london")).toBe(false);
  });

  it("refuses anything that is not an absolute http(s) url", () => {
    expect(isHarvestableOperatorUrl("")).toBe(false);
    expect(isHarvestableOperatorUrl("/whats-on")).toBe(false);
    expect(isHarvestableOperatorUrl("ftp://example.com")).toBe(false);
    expect(isHarvestableOperatorUrl(null)).toBe(false);
  });
});

describe("the run report separates empty, skipped and failed", () => {
  const reporter = createHarvestReporter({ mode: "cron", startedAt: "2026-08-09T05:00:00.000Z" });

  reporter.record({
    sourceId: "a",
    label: "A",
    url: "https://a.example/",
    kind: "chain-deals",
    firstParty: true,
    status: "harvested",
    statedItems: 5,
    rowsEmitted: 0,
    drops: countDrops(["no-stated-window", "no-stated-window", "no-stated-day"]),
  });
  reporter.record({
    sourceId: "b",
    label: "B",
    url: "https://b.example/",
    kind: "chain-deals",
    firstParty: true,
    status: "empty",
    statedItems: 0,
    rowsEmitted: 0,
    drops: [],
    evidence: "Page was read and stated no deal day.",
  });
  reporter.record({
    sourceId: "c",
    label: "C",
    url: "https://c.example/",
    kind: "venue-events",
    firstParty: false,
    status: "skipped",
    statedItems: 0,
    rowsEmitted: 0,
    drops: [],
    skipReason: "robots-disallowed",
    evidence: "robots.txt disallows the rendering crawler.",
  });
  reporter.record({
    sourceId: "d",
    label: "D",
    url: "https://d.example/",
    kind: "chain-deals",
    firstParty: true,
    status: "failed",
    statedItems: 0,
    rowsEmitted: 0,
    drops: [],
    failure: { reason: "http-error", detail: "Firecrawl returned 503.", status: 503 },
  });

  const report = reporter.finish({
    finishedAt: "2026-08-09T05:01:00.000Z",
    budget: { limit: 12, spent: 4, remaining: 8 },
  });

  it("counts each outcome as its own thing", () => {
    expect(report.totals).toEqual({
      harvested: 1,
      empty: 1,
      skipped: 1,
      failed: 1,
      statedItems: 5,
      rowsEmitted: 0,
    });
  });

  it("orders drop counts by how many there were", () => {
    expect(report.sources[0].drops).toEqual([
      { reason: "no-stated-window", count: 2 },
      { reason: "no-stated-day", count: 1 },
    ]);
  });

  it("summarises the run without collapsing empty into skipped", () => {
    const summary = summariseHarvestRun(report);
    expect(summary).toContain("1 stated nothing");
    expect(summary).toContain("1 skipped");
    expect(summary).toContain("1 failed");
    expect(summary).toContain("4/12 requests spent");
  });

  it("spells out every shortfall with its own reason", () => {
    const lines = harvestShortfallLines(report);
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.startsWith("empty b:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("skipped c (robots-disallowed):"))).toBe(true);
    expect(lines.some((line) => line.startsWith("failed d (http-error):"))).toBe(true);
  });
});
