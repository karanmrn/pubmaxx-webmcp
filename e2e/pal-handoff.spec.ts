import { test, expect } from "@playwright/test";

// DAG L16 deferred e2e (from PR #592). With palHandoff OFF (default) Pub Pal is
// byte-identical legacy — its answer cards carry only the browse deep-link and
// never the explicit "Use this Venue" acceptance affordance (offBehavior per
// lib/trustedHandoffFlags.server.ts: "Existing Pal results remain; Pal does not
// write PlanningIntent"). The ask surface still mounts.
//
// The flag-ON acceptance assertion (a "Use this Venue" link →
// /map?sel=&accept=1&src=pal on a real answer card) needs a deterministic
// /api/concierge result, which the keyless e2e env does not guarantee (concierge
// is LLM-backed). That path is covered by L16 render/unit tests and is
// documented as deferred for L20 rather than shipped as a flaky spec.

test("flag-off: Pal chat mounts and offers no Use-this-Venue acceptance", async ({ page }) => {
  const response = await page.goto("/pal/chat");
  expect(response?.status()).toBe(200);
  // The ask surface renders.
  await expect(page.getByRole("textbox").first()).toBeVisible();
  // No explicit acceptance affordance anywhere with the flag off.
  await expect(page.getByRole("link", { name: "Use this Venue" })).toHaveCount(0);
});
