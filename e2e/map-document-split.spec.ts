// `/map` HAS TWO HALVES AND ONE ADDRESS.
//
// The plain map is prerendered so the CDN can hold it (captain decision
// 2026-08-09, recorded in proxy.ts). A prerendered path has one document, so a
// request whose document really differs is rewritten to the per-request twin
// with the address bar untouched. lib/mapDocumentTwin.ts owns which is which,
// and the unit fences pin that list.
//
// What only a browser can prove is the part that made the split worth building:
// a town arrival still lands ON the town, with its own title, its own banner
// and its search narrowed to a place with no priced pack. The map freezes that
// arrival at mount, so if the rewrite ever stopped happening the drinker would
// get London instead - and nothing would say so.

import { test, expect } from "@playwright/test";

// A place the shipped index knows (public/data/uk_base/places.json), well
// outside every curated city so the arrival is not answered as one.
const TOWN = { name: "Ab Kettleby", lat: "52.8011296", lng: "-0.924373" };
const TOWN_ARRIVAL = `/map?place=${encodeURIComponent(TOWN.name)}&lat=${TOWN.lat}&lng=${TOWN.lng}`;

test.describe("the /map document split", () => {
  test("a plain /map is one prerendered document with no nonce", async ({
    page,
  }) => {
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'nonce-/);
    await expect(page).toHaveTitle(/London pub map/);
  });

  test("a camera deep link still takes the prerendered document", async ({
    page,
  }) => {
    // ?sel= moves the selection after load, so it changes no document and must
    // not fall off the CDN.
    const response = await page.goto("/map?sel=venue-xjf3n0");
    expect(response?.status()).toBe(200);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  test("a town arrival lands on the town, and keeps the nonce", async ({
    page,
  }) => {
    const response = await page.goto(TOWN_ARRIVAL);
    expect(response?.status()).toBe(200);
    // Rendered per request, so it has no CDN copy and nothing to buy with the
    // nonce being dropped.
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    // The address the drinker sees is still /map. The rewrite is ours.
    expect(new URL(page.url()).pathname).toBe("/map");
    await expect(page).toHaveTitle(new RegExp(`${TOWN.name} pub map`));

    // The server-resolved arrival reached the map, which is the whole point:
    // the name is the INDEX's, never the query string's.
    await expect(
      page.getByText(`${TOWN.name} pubs are on the map.`),
    ).toBeVisible();
  });

  test("a curated crawl share keeps its own card", async ({ page }) => {
    const response = await page.goto("/map?crawl=victorian-soho");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Victorian Soho/);
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute(
      "content",
      /city-map-card\?city=london&crawl=victorian-soho/,
    );
  });

  test("national browse retitles the page", async ({ page }) => {
    const response = await page.goto("/map?uk=1");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Pubs across the UK/);
  });
});
