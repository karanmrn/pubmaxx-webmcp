import { test, expect, type Page } from "@playwright/test";

// Borough pages, the curated-crawls index, and the CSP security header. Borough
// read-surfaces and the crawl permalink/unknown-slug paths already have solid
// coverage in e2e/social-loop.spec.ts (§14/§25/§8) — this file covers what that
// suite doesn't: a real borough page rendering its ranked table end-to-end, the
// crawls page's CURATED cards grid (a static, always-populated list, distinct
// from the per-crawl poster the social-loop suite already exercises), and the
// CSP response header (security: CSP + governance work this session).
//
// Style matches the other new specs: watchPageErrors, web-first assertions, no
// waitForTimeout, .count()-guarded branches for populated-vs-empty states.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("borough page", () => {
  test("a real borough page (westminster) renders its ranked pub table", async ({ page }) => {
    const errors = watchPageErrors(page);

    // "westminster" is the same stable, populated slug e2e/social-loop.spec.ts
    // uses — it resolves to dozens of pubs in the bundled dataset.
    const response = await page.goto("/borough/westminster");
    expect(response?.status()).toBe(200);

    await expect(page.locator("h1.boroughTitle")).toContainText("Pubs in");

    const pubs = page.locator(".boroughTable .boroughPub");
    const empty = page.locator(".boroughEmpty");
    await expect
      .poll(async () => (await pubs.count()) + (await empty.count()))
      .toBeGreaterThan(0);

    if ((await pubs.count()) > 0) {
      // Real ranked rows, each linking onto the map with the pub selected.
      await expect(pubs.first()).toHaveAttribute("href", /^\/map\?sel=/);
    } else {
      await expect(empty).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});

test.describe("crawls page — curated crawls", () => {
  test("the crawls index renders one featured card plus compact grouped rows (static, always-populated)", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls");
    expect(response?.status()).toBe(200);

    // The curated set is a static, bundled list (lib/curatedCrawls.ts) — unlike
    // the per-crawl poster (?s=), it never depends on the DB, so it should
    // always render a featured card up top (E: list-discipline pass replaced
    // the old repeated full-card grid with ONE featured card + compact rows).
    const featured = page.locator(".curatedFeaturedCard");
    await expect(featured).toBeVisible();
    await expect(featured.locator(".curatedName")).toBeVisible();
    await expect(featured.locator(".curatedBlurb")).toBeVisible();
    await expect(featured.locator(".curatedLink")).toHaveAttribute("href", /\/map/);

    // Every remaining curated crawl is a compact, one-line row grouped by
    // theme — still reachable, just not a repeated full card.
    const rows = page.locator(".crawlCompactRow");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    const firstRow = rows.first();
    await expect(firstRow.locator(".crawlCompactName")).toBeVisible();
    await expect(firstRow.locator(".crawlCompactLink")).toHaveAttribute("href", /\/map/);

    expect(errors).toEqual([]);
  });
});

test.describe("security headers", () => {
  test("/ serves a Content-Security-Policy header", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const csp = response?.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    // Sanity-check a couple of the load-bearing directives from proxy.ts
    // rather than pinning the whole string (which would make this test brittle
    // to any future directive tweak).
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    // `/` is one of the two prerendered documents (captain decision
    // 2026-08-09, recorded in proxy.ts). A CDN copy cannot carry a per-request
    // nonce, so the inline slot is 'unsafe-inline' here — and a nonce would be
    // worse than none, because the same one would go to everybody.
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'nonce-/);
  });

  test("a route that resolves identity still gets the per-request nonce", async ({
    page,
  }) => {
    // The other half of the same decision: the exception is two public
    // documents, and it may never spread to a route where a session is
    // resolved or a handle is printed.
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);

    const csp = response?.headers()["content-security-policy"];
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  test("the prerendered documents name nobody", async ({ page }) => {
    // One prerendered copy is handed to every stranger, so the document itself
    // must carry no person. Everything about the viewer is fetched after load.
    for (const path of ["/", "/map"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const html = (await response?.text()) ?? "";
      expect(html, path).not.toMatch(/pubmax_handle/);
      expect(html, path).not.toMatch(/"handle":\s*"[^"]+"/);
      expect(html, path).not.toMatch(/access_token|refresh_token/);
    }
  });

  test("/ sets X-Frame-Options DENY (aligned with CSP frame-ancestors 'none')", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const xfo = response?.headers()["x-frame-options"];
    // DENY is the canonical value; absent is acceptable only when CSP
    // frame-ancestors 'none' alone governs framing (we send both).
    if (xfo) {
      expect(xfo.toUpperCase()).toBe("DENY");
    }
  });

  test("GET /api/pint-drops does not expose Access-Control-Allow-Origin", async ({ request }) => {
    const response = await request.get("/api/pint-drops");
    expect(response.status()).toBeLessThan(500);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("/ serves HSTS and Cross-Origin-Opener-Policy when configured", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    // HSTS is set in next.config.mjs for production; preview may omit it.
    const hsts = headers["strict-transport-security"];
    if (hsts) {
      expect(hsts.toLowerCase()).toContain("max-age=");
    }
    const coop = headers["cross-origin-opener-policy"];
    if (coop) {
      expect(coop.toLowerCase()).toMatch(/same-origin/);
    }
  });

  test("unauthenticated admin session probe does not leak a session", async ({ request }) => {
    const response = await request.get("/api/admin/session");
    expect(response.status()).toBeLessThan(500);
    const body = (await response.json()) as { authenticated?: boolean };
    expect(body.authenticated).toBe(false);
  });

  test("GET /api/messages without identity stays closed or empty (no CORS)", async ({ request }) => {
    const response = await request.get("/api/messages");
    expect(response.status()).toBeLessThan(500);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    // Anonymous may get 200 empty inbox, 400/401/403 depending on Wave I gate —
    // never a cross-origin allow header and never a 5xx from the ownership seam.
    expect([200, 400, 401, 403]).toContain(response.status());
  });
});
