import { expect, test } from "@playwright/test";
import { runAccessibilityGate } from "./accessibilityGate";

test("axe gate accepts a serious/critical-clean document", async ({ page }, testInfo) => {
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><title>Accessibility gate fixture</title></head>
      <body>
        <main>
          <h1>Find a trusted pint</h1>
          <button type="button">Use this Venue</button>
        </main>
      </body>
    </html>
  `);

  const results = await runAccessibilityGate({ page, testInfo });
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});