import { expect, test } from "@playwright/test";

import {
  AUDITED_ROUTES,
  navigateToAuditedRoute,
} from "../scripts/lib/uiUxBattleTestNavigation.mjs";

test("keyless audit waits for resolved auth chrome", async ({ baseURL, page }) => {
  const home = AUDITED_ROUTES.find((route) => route.name === "home")!;
  await navigateToAuditedRoute(page, baseURL!, home, 10_000);
  await expect(page.locator('[data-auth-resolved="true"]')).toBeAttached();
});
