import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  clientFilterPayloadBytes,
  historicIndexHref,
  paginateIndexRows,
  parseHistoricFilterQuery,
  parsePubsFilterQuery,
  pubsIndexHref,
} from "@/lib/pageFilters";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("index server/client boundaries", () => {
  it("keeps filter payloads bounded without venue records", () => {
    const payload = {
      historic: {
        boroughs: Array.from({ length: 32 }, (_, index) => `Borough ${index}`),
        filters: parseHistoricFilterQuery({
          borough: "Camden",
          listed: "1",
          date: "1",
          sort: "borough",
        }),
      },
      pubs: {
        counts: {
          all: 119,
          "greene-king.co.uk": 30,
          "nicholsonspubs.co.uk": 40,
          "youngs.co.uk": 49,
          other: 0,
        },
        zones: [1, 2, 3, 4, 5, 6],
        filters: parsePubsFilterQuery({ source: "youngs.co.uk", zone: "2" }),
      },
    };

    expect(clientFilterPayloadBytes(payload)).toBeLessThan(4_000);
    expect(JSON.stringify(payload)).not.toContain('"facts"');
    expect(JSON.stringify(payload)).not.toContain('"cheapestPrice"');
  });

  it("keeps unknown URL filters at honest defaults", () => {
    expect(
      parseHistoricFilterQuery({ borough: "../../secret", sort: "random" }),
    ).toEqual({
      borough: null,
      listedOnly: false,
      hasDate: false,
      sort: "oldest",
      page: 1,
    });
    expect(parsePubsFilterQuery({ source: "unknown", zone: "99" })).toEqual({
      source: "all",
      zone: null,
      page: 1,
    });
  });

  it("keeps each server-rendered index page inside the card budget", () => {
    const rows = Array.from({ length: 119 }, (_, index) => index);
    expect(paginateIndexRows(rows, 1)).toMatchObject({
      page: 1,
      totalPages: 5,
      rows: { length: 24 },
    });
    expect(paginateIndexRows(rows, 99)).toMatchObject({
      page: 5,
      totalPages: 5,
      rows: { length: 23 },
    });
  });

  it("keeps active filters in crawlable pagination links", () => {
    expect(
      historicIndexHref(
        {
          borough: "Camden",
          listedOnly: true,
          hasDate: false,
          sort: "az",
          page: 1,
        },
        2,
      ),
    ).toBe("/historic?borough=Camden&listed=1&sort=az&page=2");
    expect(
      pubsIndexHref(
        { source: "youngs.co.uk", zone: 2, page: 1 },
        3,
      ),
    ).toBe("/pubs?source=youngs.co.uk&zone=2&page=3");
  });

  it("keeps historic and chain cards in Server Components", () => {
    const historicSource = read("app/historic/HistoricPageClient.tsx");
    expect(historicSource).not.toMatch(
      /^"use client";/m,
    );
    expect(historicSource).toContain("{totalPubs} notable pubs");
    expect(historicSource).toContain("totalPubs === 0");
    expect(read("components/pubs/PubsGallery.tsx")).not.toMatch(
      /^"use client";/m,
    );
    const pubsFilters = read("components/pubs/PubsFilters.tsx");
    expect(pubsFilters).toContain('role="group"');
    expect(pubsFilters).toContain('key: "other"');
    expect(read("app/historic/page.tsx")).toContain("paginateIndexRows");
    expect(read("app/pubs/page.tsx")).toContain("paginateIndexRows");
  });
});
