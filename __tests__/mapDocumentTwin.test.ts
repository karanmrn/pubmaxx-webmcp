// `/map` is prerendered, so it has exactly ONE document. This is the fence
// around which requests that document may answer.
//
// Two ways to get it wrong, and both are silent. Send too little to the twin
// and a share link is served the plain London card, or a town arrival lands on
// the London map with nothing anywhere saying why. Send too much and every
// selection deep link (`?sel=`) falls off the CDN and back into the cold-start
// lottery the split exists to end.

import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAP_DOCUMENT_PATH,
  MAP_DOCUMENT_QUERY_KEYS,
  MAP_DOCUMENT_TWIN_PATH,
  mapRequestNeedsDocumentTwin,
} from "@/lib/mapDocumentTwin";
import { securityProxy } from "@/proxy";

function rewriteTargetFor(url: string): string | null {
  const response = securityProxy(
    new NextRequest(url, { headers: { host: "pubmaxxing.com" } }),
  );
  const rewritten = response.headers.get("x-middleware-rewrite");
  if (!rewritten) return null;
  return new URL(rewritten, "https://pubmaxxing.com").pathname;
}

describe("which /map requests need their own document", () => {
  it.each([
    ["a town arrival", "?place=Oxford&lat=51.752&lng=-1.2577"],
    ["national browse", "?uk=1"],
    ["a cult story band", "?band=subcrawl"],
    ["a curated crawl share", "?crawl=soho-classics"],
    ["a stop list", "?pubs=venue-a,venue-b,venue-c"],
  ])("%s does", (_label, query) => {
    expect(mapRequestNeedsDocumentTwin(query)).toBe(true);
  });

  it.each([
    ["no query at all", ""],
    ["a selected venue", "?sel=venue-xjf3n0"],
    ["a search query", "?q=camden"],
    ["a campaign tag", "?utm_source=poster&utm_medium=print"],
    ["a lens", "?drink=lager"],
    // A key present but empty names nothing, so it changes no document.
    ["an empty place", "?place="],
    ["a blank crawl", "?crawl=%20"],
  ])("%s does not", (_label, query) => {
    expect(mapRequestNeedsDocumentTwin(query)).toBe(false);
  });

  it("keeps the key list closed and small", () => {
    expect([...MAP_DOCUMENT_QUERY_KEYS]).toEqual([
      "place",
      "uk",
      "band",
      "crawl",
      "pubs",
    ]);
  });
});

describe("the proxy rewrite", () => {
  it("sends a document-varying /map to the twin and keeps the query", () => {
    const response = securityProxy(
      new NextRequest(
        "https://pubmaxxing.com/map?place=Oxford&lat=51.752&lng=-1.2577",
        { headers: { host: "pubmaxxing.com" } },
      ),
    );
    const rewritten = response.headers.get("x-middleware-rewrite");
    expect(rewritten).toBeTruthy();
    const target = new URL(rewritten as string, "https://pubmaxxing.com");
    expect(target.pathname).toBe(MAP_DOCUMENT_TWIN_PATH);
    // The place, and the coordinates that choose between same-named places,
    // must survive: the twin resolves them against the shipped index.
    expect(target.searchParams.get("place")).toBe("Oxford");
    expect(target.searchParams.get("lat")).toBe("51.752");
    expect(target.searchParams.get("lng")).toBe("-1.2577");
  });

  it("leaves an ordinary /map alone so the CDN copy answers it", () => {
    expect(rewriteTargetFor("https://pubmaxxing.com/map")).toBeNull();
    expect(
      rewriteTargetFor("https://pubmaxxing.com/map?sel=venue-xjf3n0"),
    ).toBeNull();
  });

  it("rewrites a prefetch of a share link too", () => {
    // A prefetch skips the CSP block entirely. Left unrewritten, the client
    // router would cache the plain shell's payload under the share link's URL.
    expect(
      rewriteTargetFor("https://pubmaxxing.com/map?crawl=soho-classics"),
    ).toBe(MAP_DOCUMENT_TWIN_PATH);
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/map?crawl=soho-classics", {
        headers: { host: "pubmaxxing.com", "next-router-prefetch": "1" },
      }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBeTruthy();
  });

  it("never rewrites another city's map", () => {
    expect(
      rewriteTargetFor("https://pubmaxxing.com/map/bristol?band=harbourside"),
    ).toBeNull();
  });
});

describe("the two halves stay one page", () => {
  it("renders the same shell from the same city", () => {
    const twin = readFileSync(
      join(process.cwd(), "app/map/arrival/page.tsx"),
      "utf8",
    );
    const shell = readFileSync(join(process.cwd(), "app/map/page.tsx"), "utf8");
    for (const source of [twin, shell]) {
      expect(source).toContain('cityId="london"');
      expect(source).toContain("PubMaxingShell");
      expect(source).toContain("PintIndexMapArrival");
      // One owner for the plain London card, so a share link and the shell
      // cannot drift apart.
      expect(source).toContain("londonMapMetadata");
    }
  });

  it("keeps the shell free of per-request reads", () => {
    const shell = readFileSync(join(process.cwd(), "app/map/page.tsx"), "utf8");
    expect(shell).toContain('export const dynamic = "force-static"');
    expect(shell).toMatch(/export const revalidate = \d+/);
    expect(shell).not.toContain("searchParams");
    // The request-scoped APIs are reached by importing them, so the import is
    // the fence a comment cannot trip.
    expect(shell).not.toMatch(/from "next\/headers"/);
    expect(shell).not.toMatch(/from "next\/navigation"/);
  });

  it("keeps every document the twin answers canonically at /map", () => {
    const twin = readFileSync(
      join(process.cwd(), "app/map/arrival/page.tsx"),
      "utf8",
    );
    // Three metadata branches (national browse, place arrival, share card) and
    // each one is /map's document, rendered somewhere else.
    const canonical = twin.match(/alternates: \{ canonical: "\/map" \}/g) ?? [];
    expect(canonical).toHaveLength(3);
    const noindex = twin.match(/robots: \{ index: false, follow: true \}/g) ?? [];
    expect(noindex).toHaveLength(3);
    expect(MAP_DOCUMENT_PATH).toBe("/map");
  });
});
