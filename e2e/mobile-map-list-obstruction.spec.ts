import { expect, test, type Page } from "@playwright/test";

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function prepareReturningVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
  });
}

async function openVenueList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More map controls" }).click();
  const layersSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="layers"]:visible',
  );
  await expect(layersSheet).toBeVisible();
  await layersSheet.getByRole("tab", { name: "Layers" }).click();
  await layersSheet
    .getByRole("button", { name: "List view of venues on the map" })
    .click();
  await expect(page.locator(".mapVenueListPanel")).toBeVisible();
}

async function loadMobileMap(
  page: Page,
  viewport: (typeof MOBILE_VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareReturningVisitor(page);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: 30_000,
  });
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`venue-list rows own their taps at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loadMobileMap(page, viewport);
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await openVenueList(page);

    const rowChecks = await page.locator(".mapVenueListPanel").evaluate(
      (panel) => {
        const scroller = panel.querySelector<HTMLElement>(".mapVenueListGroups");
        const rows = Array.from(
          panel.querySelectorAll<HTMLButtonElement>(".mapVenueListItem"),
        );
        if (!scroller || rows.length === 0) {
          return {
            failureCount: 1,
            failures: ["venue list has no tappable rows"],
            lastPoint: null,
          };
        }

        let failureCount = 0;
        const failures: string[] = [];
        let lastPoint: { x: number; y: number } | null = null;
        for (const row of rows) {
          const before = row.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          scroller.scrollTo({
            top:
              scroller.scrollTop +
              Math.max(0, before.bottom - scrollerRect.bottom),
            behavior: "instant" as ScrollBehavior,
          });

          const rect = row.getBoundingClientRect();
          const visibleRect = scroller.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);

          if (
            rect.top < visibleRect.top - 0.5 ||
            rect.bottom > visibleRect.bottom + 0.5
          ) {
            failureCount += 1;
            if (failures.length < 5) {
              failures.push(`${row.dataset.venueId ?? row.textContent}: clipped`);
            }
          }
          if (!hit || !row.contains(hit)) {
            failureCount += 1;
            if (failures.length < 5) {
              const hitOwner = hit instanceof HTMLElement
                ? hit.closest<HTMLElement>("[aria-label]")?.getAttribute("aria-label")
                  ?? hit.className
                : "nothing";
              failures.push(
                `${row.dataset.venueId ?? row.textContent}: tap owned by ${hitOwner}`,
              );
            }
          }
          lastPoint = { x, y };
        }
        return { failureCount, failures, lastPoint };
      },
    );

    expect(
      rowChecks.failureCount,
      `venue rows with clipped content or stolen centre taps: ${rowChecks.failures.join("; ")}`,
    ).toBe(0);
    expect(rowChecks.lastPoint).not.toBeNull();
    if (!rowChecks.lastPoint) return;

    await page.mouse.click(rowChecks.lastPoint.x, rowChecks.lastPoint.y);
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="venue"]'),
    ).toBeVisible();
  });

  test(`planner action yields to venue list and returns at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loadMobileMap(page, viewport);
    await expect(
      page.getByRole("button", { name: "Describe the outing" }),
    ).toBeVisible();
    await openVenueList(page);
    await expect(
      page.getByRole("button", { name: "Describe the outing" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close venue list" }).click();
    const plannerAction = page.getByRole("button", {
      name: "Describe the outing",
    });
    await expect(plannerAction).toBeVisible();
    await plannerAction.click();
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="planner"]'),
    ).toBeVisible();
  });

}
