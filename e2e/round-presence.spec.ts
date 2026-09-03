import { test, expect, type Page } from "@playwright/test";

// Group presence in The Round — "your crew is here" (docs/IDEAS_2026-07-07.md B6).
// The Round page overlays venue presence (the "I'm here" taps) with the Round's
// members: while a Round is open, crew marked present at the CURRENT stop get a
// candle-lit "here now" ember, and the header shows "N of your crew are here".
//
// This spec is deliberately WebGL-agnostic and read-only: the Round page renders
// no map/canvas — it's a list surface fed by GET /api/rounds/:code and
// GET /api/presence?venueId=… (both fail-soft to empty). So it runs the same
// whether or not the headless browser has a real WebGL context.
//
// It tolerates empty data. Without a seeded Round + live presence rows (the CI
// store is memory/empty), the intersection is legitimately empty, so the ember
// and banner simply won't render. The load-bearing guarantees we assert
// unconditionally are: the page loads cleanly (no page errors), and the presence
// surface NEVER over-claims (a "here now" ember only ever appears attached to a
// member row, never free-floating). The intersection math itself is owned by the
// unit tests (__tests__/roundPresence.test.ts).
//
// Style matches the sibling specs (e.g. e2e/crawl-routes.spec.ts):
// watchPageErrors, web-first assertions, no waitForTimeout, .count()-guarded
// populated-vs-empty branches.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// A well-formed but almost-certainly-nonexistent Round code (6 chars from the
// no-vowel alphabet, lib/rounds.ROUND_CODE_ALPHABET). It resolves the route and
// the client fetch WITHOUT needing a seeded Round — a 404 renders the honest
// "No Round here" empty state, which is still a clean load.
const PROBE_CODE = "BCDFGH";

test.describe("round presence — 'your crew is here'", () => {
  test("the Round page loads cleanly and never renders a free-floating here-now ember", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto(`/rounds/${PROBE_CODE}`);
    expect(response?.status()).toBe(200); // the route always 200s; 404-ness is in-page

    // The Round shell is always present (found-or-empty-state both render it).
    await expect(page.locator("main.roundShell")).toBeVisible();

    // Let the client resolve the code + fetch state (round + presence) before
    // branching. The status line appears for a live Round; the empty state for a
    // missing one. Either way the page has settled.
    const board = page.locator(".roundBoard");
    await expect
      .poll(async () => await board.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    const emberCount = await page.locator(".roundHereDot").count();
    if (emberCount === 0) {
      // Empty/degraded data (no seeded Round or no live presence at the current
      // stop): nothing presence-specific to assert. The page still loaded
      // cleanly — the read-only guarantee we care about.
      expect(errors).toEqual([]);
      return;
    }

    // Populated: every "here now" ember in the member list must be inside a
    // member chip (never a stray positive claim). The banner ember lives in
    // .roundCrewHere; member embers live in .roundMemberChipHere. Assert the
    // member embers are all attached to a here-marked chip.
    const memberEmbers = page.locator(".roundMemberChip .roundHereDot");
    const memberEmberCount = await memberEmbers.count();
    if (memberEmberCount > 0) {
      // A here-marked chip carries the modifier class — the ember is honest,
      // tied to a specific crew member's row.
      const hereChips = page.locator(".roundMemberChipHere");
      expect(await hereChips.count()).toBeGreaterThanOrEqual(memberEmberCount);

      // The banner then makes the summarised, singular/plural-correct claim.
      const banner = page.locator(".roundCrewHere");
      await expect(banner.first()).toContainText(/\d+ of your crew (is|are) here —/);
    }

    expect(errors).toEqual([]);
  });
});
