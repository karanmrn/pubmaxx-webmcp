import { expect, test, type Page } from "@playwright/test";

import { parsePosthogIngest, type IngestEvent } from "./helpers/posthogIngest";

const VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: { cookies: [], origins: [] } });

async function consentedPage(page: Page): Promise<IngestEvent[]> {
  const observed: IngestEvent[] = [];
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/ingest/")
      && request.method() === "POST") {
      observed.push(...parsePosthogIngest(request));
    }
  });
  // Stub only the capture endpoint. The SDK lazy-loads its exception-autocapture
  // extension from /ingest/static/, so stubbing every /ingest/ path would replace
  // that script and silently uninstall the error handler under test.
  await page.route("**/ingest/**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Allow", exact: true }).click();
  return observed;
}

/**
 * The SDK installs its error handler only once the lazily fetched extension
 * lands, so a single throw races that load. Throw until the crash is observed.
 */
async function crashUntilCaptured(
  page: Page,
  observed: IngestEvent[],
): Promise<IngestEvent> {
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new TypeError("pubmax e2e crash probe");
        }, 0);
      });
      await page.waitForTimeout(500);
      return observed.some((entry) => entry.event === "$exception");
    }, { timeout: 30_000, intervals: [500] })
    .toBe(true);
  const crash = observed.find((entry) => entry.event === "$exception");
  expect(crash, "an $exception event reached the capture endpoint").toBeTruthy();
  return crash as IngestEvent;
}

test("an uncaught crash reaches PostHog, named by surface and carrying no user text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const observed = await consentedPage(page);

  await expect
    .poll(() => observed.some((entry) => entry.event === "$pageview"), {
      timeout: 20_000,
    })
    .toBe(true);

  const crash = await crashUntilCaptured(page, observed);
  const properties = crash.properties;

  // Grouping: error tracking fingerprints on exception type plus message, so a
  // constant message would collapse every TypeError in the app into one issue.
  expect(properties.$exception_list).toEqual([
    { type: "TypeError", value: "Redacted (/)" },
  ]);
  expect(properties.$pathname).toBe("/");

  // Identity and device context still travel, exactly as /privacy describes.
  expect(properties.distinct_id).toMatch(/^anon_[a-f0-9-]{16,64}$/);
  expect(properties.$device_id).toBe(properties.distinct_id);
  expect(properties.$browser).toBeTruthy();
  expect(properties.$os).toBeTruthy();
  expect(properties.$device_type).toBeTruthy();

  // Nothing that could carry user text, a full URL or a stack frame.
  expect(properties.$current_url).toBeUndefined();
  expect(properties.$referrer).toBeUndefined();
  expect(properties.$initial_referrer).toBeUndefined();
  expect(properties.$exception_message).toBeUndefined();
  const serialised = JSON.stringify(properties);
  expect(serialised).not.toContain("pubmax e2e crash probe");
  expect(serialised).not.toContain("stacktrace");
});
