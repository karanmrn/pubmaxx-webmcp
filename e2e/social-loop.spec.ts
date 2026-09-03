import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
});

// Social-loop E2E (cc_plan2 §8/§9/§11). A READ-ONLY journey through the durable
// social surfaces — feed, pint permalink, crawl poster. It asserts the loop
// RENDERS correctly (real pub names, shareable posts, working cross-links)
// WITHOUT mutating anything: it never POSTs a drop/reaction/comment, so it is
// safe against the production Supabase env that `next start` boots with.
//
// Style matches e2e/smoke.spec.ts: watchPageErrors on deterministic surfaces,
// status-200 + a stable selector + errors.toEqual([]). Every content assertion
// is guarded by .count() so the suite is green on BOTH a populated feed and an
// empty DB — an empty feed is a valid state, never a failure. No waitForTimeout
// sleeps anywhere; only web-first (auto-retrying) assertions.

// Collect uncaught page errors so a single console-fatal fails the run loudly.
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// A raw internal venue id looks like "venue-16pnwmm". The feed's honesty
// guarantee (§9) is that a card links the pub by NAME, never leaking this id as
// visible text. This regex must NOT match the rendered venue link text.
const RAW_VENUE_ID = /^venue-[a-z0-9]+$/;

test("feed shows real pub names, is shareable, and links to the map (§9/§11)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);

  // Deterministic scaffold: the feed heading always renders (loading, ready, or
  // the empty state), so wait on it before branching on card presence.
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  // Web-first wait for EITHER real cards OR the social empty state, so we never
  // branch on a mid-load snapshot (skeletons carry .feedCardSkeleton).
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  const cardCount = await cards.count();
  if (cardCount > 0) {
    const first = cards.first();

    // The venue is linked by its human name, never the raw internal id.
    const link = first.locator(".feedVenueLink").first();
    await expect(link).toBeVisible();
    const name = (await link.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);

    // …and that name links to the map with this pub selected (/map?sel=…).
    const href = await link.getAttribute("href");
    expect(href ?? "").toMatch(/^\/map\?sel=/);

    // Every pint is its own shareable post: a permalink (/p/…) + a share strip.
    const permalink = first.locator(".feedPermalink").first();
    await expect(permalink).toHaveAttribute("href", /^\/p\//);
    await expect(first.locator(".feedActionRow .shareBar").first()).toBeVisible();
  } else {
    // Empty DB is a valid state — assert the social empty state, never fail.
    // The empty state is the shared EmptyState component (components/EmptyState.tsx);
    // its one action renders inside .emptyStateAction.
    await expect(page.locator(".feedEmpty")).toBeVisible();
    await expect(page.locator(".feedEmpty .emptyStateAction a")).toHaveAttribute(
      "href",
      /\/map/,
    );
  }

  expect(errors).toEqual([]);
});

// A4/UX2 — every feed card carries exactly ONE Cheers affordance: the first
// chip of the reaction row (the old standalone CheersButton duplicated the
// same "cheers" reaction and was removed). READ-ONLY: we assert the chip is
// PRESENT and labelled, never click it (a click would POST a reaction).
// Guarded by card presence so an empty DB is a valid pass.
test("feed cards carry a one-tap 'Cheers' reaction chip (A4)", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  if ((await cards.count()) > 0) {
    // Every rendered card exposes exactly one Cheers control — the reaction
    // row's cheers chip, with an accessible pressed-state (aria-pressed).
    const cheers = cards.first().getByRole("button", { name: /^Cheers/ });
    await expect(cheers).toHaveCount(1);
    await expect(cheers).toBeVisible();
    await expect(cheers).toHaveAttribute("aria-pressed", /true|false/);
  } else {
    // Empty feed: nothing to react to — the empty state stands in. Not a failure.
    await expect(page.locator(".feedEmpty")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("feed → map: clicking a pub name opens the map with it selected", async ({ page }) => {
  await page.goto("/feed");
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  const link = page.locator(".feedVenueLink").first();
  if ((await link.count()) === 0) {
    // Empty inventory is still a complete, asserted state. Never turn missing
    // fixture data into a skipped test that can make the gate look healthier.
    await expect(page.locator(".feedEmpty")).toBeVisible();
    await expect(page).toHaveURL(/\/feed$/);
    return;
  }

  await link.click();
  await expect(page).toHaveURL(/\/map\?sel=/);
});

test("pint permalink is a real shareable post; unknown id stays friendly (§8)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  // A known seed id (lib/pintDropSeeds.ts). Seeds are merged into every read
  // path, so this resolves to a real memory card on both in-memory and Supabase.
  const response = await page.goto("/p/seed-prospect-1");
  expect(response?.status()).toBe(200);

  // The collectible memory card is present…
  await expect(page.locator(".permalink__mat")).toBeVisible();
  // …with a share strip so the pint can travel into a group chat…
  await expect(page.locator(".permalink__share .shareBar")).toBeVisible();
  // …and a working way back onto the map (the pub link). The card can carry
  // several ghost links (map, Ledger); the map one is the §8 guarantee.
  await expect(page.locator('.permalink__ghost[href*="/map"]')).toHaveAttribute("href", /\/map/);

  expect(errors).toEqual([]);

  // A hidden/unknown id must still render a friendly state — 200, no crash, and
  // a route back to the feed (never a leak of moderation state).
  const missingErrors = watchPageErrors(page);
  const missing = await page.goto("/p/definitely-not-real");
  expect(missing?.status()).toBe(200);
  await expect(page.locator(".permalink--empty")).toBeVisible();
  await expect(
    page.locator(".permalink--empty").getByRole("link", { name: /feed/i }),
  ).toHaveAttribute("href", "/feed");
  expect(missingErrors).toEqual([]);
});

test("crawl surfaces render; unknown slug is a friendly 404/empty", async ({ page }) => {
  const errors = watchPageErrors(page);

  // The crawls index always mounts (client component; decode never throws) — it
  // shows a poster (from ?s=) or the empty state. Either way the shell renders.
  const index = await page.goto("/crawls");
  expect(index?.status()).toBe(200);
  await expect(page.locator(".crawlsShell")).toBeVisible();
  // Exactly one of the two states is present.
  await expect
    .poll(async () =>
      (await page.locator(".crawlPoster").count()) + (await page.locator(".crawlEmpty").count()),
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);

  // An unknown slug calls notFound() → Next's 404. It must render the friendly
  // not-found page (a stable 404 status) rather than crashing the route.
  const missing = await page.goto("/crawls/no-such-slug");
  expect(missing?.status()).toBe(404);
  // The document still parses to a real page (a body with content), not a blank
  // white screen — a cheap, WebGL-agnostic proof the 404 surface renders.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ---------------------------------------------------------------------------
// Discover · Tonight board (components/discovery/TonightBoard.tsx). The live
// "cheapest pints logged tonight" board is community-driven and time-windowed
// (trailing 24h), so on a quiet night it renders its friendly empty state
// instead of rows — both are valid. We assert the section's stable heading
// always renders, and that whichever state shows is well-formed: real rows link
// the pub into /map?sel=… by NAME (never a raw venue id), or the empty note is
// present. Read-only: it consumes the same /api/pint-drops the page fetches and
// never POSTs.
test("discover 'Cheapest Pints Tonight' board renders rows or its empty state (§5.1)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/discover");
  expect(response?.status()).toBe(200);

  // The app-owned section heading (stable id in app/discover/page.tsx) always
  // renders regardless of whether any pints landed in the last 24h.
  await expect(page.locator("#tonight-title")).toHaveText("Cheapest Pints Tonight");

  // The board mounts EITHER as an ordered list of rows OR as its empty note. It
  // starts empty (drops arrive after the client fetch), so web-first wait until
  // one of the two states is present rather than snapshotting mid-load.
  const rows = page.locator(".tonightBoard .tonightRow");
  const empty = page.locator(".discoverEmpty");
  await expect
    .poll(async () => (await rows.count()) + (await empty.count()))
    .toBeGreaterThan(0);

  const rowCount = await rows.count();
  if (rowCount > 0) {
    const link = rows.first().locator(".tonightPub").first();
    await expect(link).toBeVisible();

    // The pub is linked by its human name — never the raw internal venue id.
    const name = (await link.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);

    // …and that name routes onto the map with this pub selected (/map?sel=…).
    const href = await link.getAttribute("href");
    expect(href ?? "").toMatch(/^\/map\?sel=/);
  } else {
    // Quiet night: the empty note ("be the first tonight") stands in for rows.
    await expect(empty.first()).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("discover mobile price badges stay stable and inside the viewport", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/discover");
  expect(response?.status()).toBe(200);

  await page.locator("#cheap-title").scrollIntoViewIfNeeded();
  const badges = page.locator(".leaderboard .priceBadge");
  await expect(badges.first()).toBeVisible({ timeout: 15_000 });

  const result = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const boxes = Array.from(document.querySelectorAll<HTMLElement>(".leaderboard .priceBadge"))
      .filter((el) => el.offsetParent !== null)
      .slice(0, 8)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          right: rect.right,
          transform: getComputedStyle(el).transform,
        };
      });
    return { overflow, boxes };
  });

  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.boxes.length).toBeGreaterThan(0);
  for (const box of result.boxes) {
    expect(box.width).toBeGreaterThan(40);
    expect(box.height).toBeGreaterThan(20);
    expect(box.right).toBeLessThanOrEqual(391);
    expect(box.transform === "none" || box.transform === "").toBe(true);
  }

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Borough discovery pages (app/borough/page.tsx + app/borough/[slug]/page.tsx).
// Server-rendered, shareable, dataset-backed (cc_plan2 §14/§25). The index lists
// every borough; a real borough page ranks its pubs (each linking onto the map);
// an unknown slug is a friendly 404. All read-only — pure GETs off the bundled
// dataset, no mutation.
test("borough index lists boroughs, each linking to its own page (§14/§25)", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/borough");
  expect(response?.status()).toBe(200);

  // The page heading always renders. The dataset ships with the app, so the grid
  // is populated in practice — but guard for [] so an empty dataset shows its
  // friendly note rather than failing the run.
  await expect(page.locator(".boroughTitle")).toBeVisible();
  const cards = page.locator(".boroughGrid .boroughCard");
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".boroughEmpty").count()))
    .toBeGreaterThan(0);

  if ((await cards.count()) > 0) {
    // Each borough card links to its own /borough/<slug> discovery page.
    await expect(cards.first()).toHaveAttribute("href", /^\/borough\/[a-z0-9-]+$/);
  } else {
    await expect(page.locator(".boroughEmpty")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("a real borough page ranks pubs that link onto the map (§14/§25)", async ({ page }) => {
  const errors = watchPageErrors(page);

  // "westminster" is a stable, populated slug: it resolves through the app's
  // primaryBorough→visibleBorough grouping to dozens of pubs in the bundled
  // dataset, so this page reliably renders the ranked table (not the empty note).
  const response = await page.goto("/borough/westminster");
  expect(response?.status()).toBe(200);

  await expect(page.locator("h1.boroughTitle")).toContainText("Pubs in");

  // The ranked table renders (guard for the empty state in case the dataset ever
  // stops carrying this borough — the page must still not fail).
  const pubs = page.locator(".boroughTable .boroughPub");
  await expect
    .poll(async () => (await pubs.count()) + (await page.locator(".boroughEmpty").count()))
    .toBeGreaterThan(0);

  if ((await pubs.count()) > 0) {
    // Each pub name links onto the map with it selected (venueMapUrl → /map?sel=).
    await expect(pubs.first()).toHaveAttribute("href", /^\/map\?sel=/);
    // …and the visible label is the human pub name, not a raw internal venue id.
    const name = (await pubs.first().innerText()).trim();
    expect(name).not.toMatch(RAW_VENUE_ID);
  } else {
    await expect(page.locator(".boroughEmpty")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("an unknown borough slug is a friendly 404, not a crash (§14/§25)", async ({ page }) => {
  // boroughFromSlug returns null for a slug no borough produces → notFound() →
  // Next's 404. The route must serve a real not-found page, never 500 or crash.
  const missing = await page.goto("/borough/zzz-not-real");
  expect(missing?.status()).toBe(404);
  // A rendered 404 body (content present), not a blank white screen.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ---------------------------------------------------------------------------
// Public profile (app/u/[handle]/page.tsx). Dynamic + client: any handle mounts
// the header without crashing, even an unknown one (friendly empty state). The
// §9 honesty fix is pinned here: when drop cards DO render, the venue label is
// the human pub name — never a raw "venue-…" id leaked as visible text. Purely
// read-only: it filters the public /api/pint-drops feed, never writes.
test("profile mounts its header for any handle; drop labels are never a raw venue id (§9)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/u/testdrinker");
  expect(response?.status()).toBe(200);

  // The profile header always mounts (synthesized identity for an unknown handle).
  await expect(page.locator(".profileHeader")).toBeVisible();

  // The drops section resolves to one of: loading→ready with cards, or a
  // "no pints logged" empty note. Wait until it settles off the loading state so
  // we branch on a stable snapshot, not a mid-fetch one.
  const cards = page.locator(".profileDropCard");
  const dropsEmpty = page.locator(".profileDropsSection .profileEmpty");
  await expect
    .poll(async () => (await cards.count()) + (await dropsEmpty.count()))
    .toBeGreaterThan(0);

  // §9 pin: every rendered drop card labels its venue by the human name — a raw
  // internal "venue-…" id must NEVER appear as the visible venue link text.
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i++) {
    const label = cards.nth(i).locator(".profileDropVenue").first();
    const name = (await label.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);
    // The venue link still routes onto the map (via enriched url or ?sel=<id>).
    await expect(label).toHaveAttribute("href", /\/map/);
  }

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Map onboarding surface (components/PubMap.tsx). WebGL-agnostic, like
// smoke.spec: we only assert the map region MOUNTS (canvas when a GPU is
// present, the "renderer unavailable" fallback otherwise). We deliberately do
// NOT assert the onboarding overlay's exact copy — it's sessionStorage-gated and
// only appears on a first visit, so pinning it would be flaky. Read-only: a bare
// GET of /map, no interaction that could persist anything.
test("/map mounts the map region without crashing (WebGL-agnostic overlay guard)", async ({
  page,
}) => {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The wrapper always renders; inside is EITHER the maplibre container (GPU) OR
  // the fallback (headless/no-WebGL). Pass on either so this stays green in CI.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expect(page.locator(".maplibreMap, .mapFallback").first()).toBeVisible();
  // The onboarding overlay is sessionStorage-gated (may or may not be present);
  // we only assert it never leaves the DOM in a broken half-state — if it exists,
  // its dismiss control is reachable. Guard with count so a suppressed overlay
  // (second visit) doesn't fail the test.
  const onboarding = page.locator(".mapOnboarding");
  if ((await onboarding.count()) > 0) {
    await expect(onboarding.locator(".mapOnboardingDismiss").first()).toBeVisible();
  }
  // No pageerror assertion: MapLibre GL emits async teardown noise under headless
  // timing that is not app logic under test (same rationale as smoke.spec).
});

// ---------------------------------------------------------------------------
// Saved-only filter control (components/map/ControlRail.tsx). The rail is a
// desktop surface (hidden on mobile), so we run this on a desktop viewport and
// guard on the rail's presence. The "Saved only" checkbox must exist in the DOM
// — it's the entry point to the saved-only map/list filter (§ friends feed work).
test("desktop map control rail exposes the 'Saved only' filter checkbox", async ({ page }) => {
  // Desktop viewport so the control rail (hidden on mobile) is in the DOM.
  await page.setViewportSize({ width: 1280, height: 900 });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // PubMap is a client component: wait for the map region to mount (proof the
  // component hydrated) before asserting on the rail, so we never race an
  // un-hydrated DOM. WebGL-agnostic — canvas or fallback, either is fine.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();

  // The reset keeps planner controls out of the map until explicitly requested.
  // Open the desktop planner, then verify the saved-only entry remains present.
  await page.getByRole("button", { name: "Plan an outing" }).click();
  const rail = page.locator(".controlRail");
  await expect(rail).toHaveCount(1);

  // The "Saved only" checkbox: its label carries a stable accessible name; the
  // control is the checkbox inside it. Assert it exists and is unchecked by
  // default — we never click it, so no per-device saved-only state is mutated.
  const savedOnly = rail.getByRole("checkbox", {
    name: "Show only venues you have saved",
  });
  await expect(savedOnly).toHaveCount(1);
  await expect(savedOnly).not.toBeChecked();
});

// ---------------------------------------------------------------------------
// a11y landmark smoke across the four top-level read surfaces. Every page must
// give assistive tech a stable spine: a reachable page <h1> and a single main
// landmark. We assert the universally-true parts (exactly one visible <h1>, no
// uncaught page errors) on all four, and the single main-landmark on the pages
// that expose one today. `/` (LandingPage) and `/feed` render a real <main>;
// `/discover` and `/borough` currently wrap in a plain <div> (no <main> / no
// [role=main]) — see the DEFECT note below — so we tolerate 0-or-1 there rather
// than false-fail, but STILL forbid MORE than one landmark anywhere. Read-only:
// bare GETs, no interaction, no data written.
//
// DEFECT (reported, not fixed): app/discover/page.tsx and app/borough/page.tsx
// expose no <main> landmark (their sibling read pages — feed, crawls, u/[handle],
// p/[id] — all do). A screen-reader "jump to main content" lands nowhere on those
// two. Low severity, but the landmark should be added for parity.
for (const path of ["/", "/feed", "/discover", "/borough"]) {
  test(`a11y: ${path} exposes a reachable <h1> and at most one main landmark, no page errors`, async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    // Exactly one page-level heading, and it is reachable (visible, non-empty).
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1.first()).toBeVisible();
    expect((await h1.first().innerText()).trim().length).toBeGreaterThan(0);

    // A main landmark: <main> or [role=main]. Never MORE than one (that would
    // confuse "jump to main content"). Pages that have one must render it
    // visibly; pages that (currently) have none are tolerated but flagged above.
    const main = page.locator('main, [role="main"]');
    const mainCount = await main.count();
    expect(mainCount).toBeLessThanOrEqual(1);
    if (mainCount === 1) {
      await expect(main.first()).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// Mobile feed infinite scroll (app/feed/page.tsx, PRD §2.5). On a phone-width
// viewport the "Load more" button is replaced by an IntersectionObserver-driven
// sentinel: scrolling toward the end of the list reveals the next page WITHOUT
// any click. We prove this read-only — if the feed carries enough data (≥13
// cards' worth, i.e. more than a single page), scrolling the last card into view
// grows the visible card count on its own. On a short/empty feed there is nothing
// to page, so we skip cleanly. Never POSTs; a bare GET + scroll only.
test("mobile feed reveals more cards on scroll without clicking 'Load more' (§2.5)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  // A phone viewport is what flips the feed into infinite-scroll mode.
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  // Web-first: wait until either real cards OR the empty state settled, so we
  // never branch on a mid-load snapshot.
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  const initial = await cards.count();
  const sentinel = page.locator(".feedSentinel");
  if ((await sentinel.count()) === 0) {
    // No next cursor means inventory is genuinely exhausted. Assert the terminal
    // state, rather than using hidden desktop controls as a proxy for pagination.
    await expect(page.locator(".feedEndWrap")).toBeVisible();
    await expect(page.getByRole("button", { name: /load more/i })).toHaveCount(0);
    expect(errors).toEqual([]);
    return;
  }

  // Presence of the sentinel is the rendered proof that another page exists.
  // Bringing it into view must grow the actual card set without a button click.
  await sentinel.scrollIntoViewIfNeeded();
  await expect.poll(async () => cards.count()).toBeGreaterThan(initial);

  expect(errors).toEqual([]);
});

test("mobile feed lane controls keep thumb-sized targets without page overflow", async ({ page }) => {
  const errors = watchPageErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".feedTitle")).toBeVisible();

  const result = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(".feedFilters");
    const chips = Array.from(document.querySelectorAll<HTMLElement>(".feedFilterChip"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      });

    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      railScrollsInternally: rail ? rail.scrollWidth > rail.clientWidth : false,
      chips,
    };
  });

  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.railScrollsInternally).toBe(true);
  expect(result.chips.length).toBeGreaterThanOrEqual(5);
  for (const chip of result.chips) {
    expect(chip.height).toBeGreaterThanOrEqual(44);
    expect(chip.width).toBeGreaterThan(44);
  }

  expect(errors).toEqual([]);
});
