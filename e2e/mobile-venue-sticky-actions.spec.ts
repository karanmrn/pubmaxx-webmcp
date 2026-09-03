import { expect, test } from "@playwright/test";

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("mobile venue sticky Share and Crawl actions stay tappable in build mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-shared-url", value);
        },
      },
    });
  });

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toHaveClass(/open/);
  await portal.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(sheet).toHaveClass(/sheet-full/);

  const stickyActions = portal.getByRole("toolbar", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  await stickyActions.getByRole("button", { name: /share arnos arms/i }).click();
  await expect(stickyActions.getByRole("status")).toHaveText(
    "Share failed, but the link was copied.",
  );
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-shared-url"))).toContain(
    `/map?sel=${ARNOS_ARMS_ID}`,
  );

  const crawlButton = stickyActions.getByRole("button", { name: "Crawl" });
  await expect(crawlButton).toHaveAttribute("aria-pressed", "false");
  await crawlButton.click();
  const removeButton = stickyActions.getByRole("button", { name: "Remove" });
  await expect(removeButton).toHaveAttribute("aria-pressed", "true");
  await removeButton.click();
  await expect(crawlButton).toHaveAttribute("aria-pressed", "false");

});

test("mobile sticky Train action opens Last train and the sheet reopens cleanly", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toHaveClass(/open/);
  await portal.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(sheet).toHaveClass(/sheet-full/);

  const stickyActions = portal.getByRole("toolbar", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  // Tab row is the single Train entry point; the strip holds actions only.
  const lastTrainTab = portal.getByRole("tab", { name: "Last train", exact: true });
  await lastTrainTab.click();
  await expect(lastTrainTab).toHaveAttribute("aria-selected", "true");
  await expect(portal.locator("#venuePanel-getting-home")).toBeVisible();
  await expect(sheet).toHaveClass(/sheet-full/);

  // Trusted-handoff §4.6: a reload while the Venue is selected retains it (the
  // sentinel keeps `sel` in the URL), so the sheet reopens cleanly at Overview.
  // (Close now pops the selected entry with Back — covered in
  // e2e/map-selection-history.spec.ts — so we reload with the sheet still open.)
  await page.reload();
  const reopenedPortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(reopenedPortal).toBeVisible();
  await expect(reopenedPortal.locator(".mobileSharedSheet")).toHaveClass(/open/);
  await expect(reopenedPortal.getByRole("toolbar", { name: "Venue actions" })).toBeVisible();
  await expect(reopenedPortal.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(reopenedPortal.locator("#venuePanel-overview")).toBeVisible();
});
