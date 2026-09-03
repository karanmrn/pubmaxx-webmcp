import { expect, test, type Page, type Request } from "@playwright/test";

import { parsePosthogIngest } from "./helpers/posthogIngest";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: { cookies: [], origins: [] } });

type ObservedIngest = {
  request: Request;
  event: string | null;
  pathname: string | null;
};

// One capture request carries a batch, so it observes one entry per event.
function parseIngest(request: Request): ObservedIngest[] {
  const events = parsePosthogIngest(request);
  if (events.length === 0) return [{ request, event: null, pathname: null }];
  return events.map(({ event, properties }) => ({
    request,
    event,
    pathname: typeof properties.$pathname === "string"
      ? properties.$pathname
      : null,
  }));
}

async function prepareFirstVisit(page: Page): Promise<ObservedIngest[]> {
  const observed: ObservedIngest[] = [];
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/ingest/")) {
      if (request.method() === "POST") observed.push(...parseIngest(request));
      else observed.push({ request, event: null, pathname: null });
    }
  });
  await page.route("**/ingest/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  return observed;
}

test("declining is remembered and sends nothing", async ({ page }) => {
  test.setTimeout(60_000);
  const ingestRequests = await prepareFirstVisit(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("PUBMAXXING uses optional analytics")).toBeVisible();

  for (const name of ["Allow", "No thanks"]) {
    const button = prompt.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
  }

  expect(await prompt.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await prompt.getByRole("button", { name: "No thanks" }).click();

  await expect(prompt).toBeHidden();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBe("denied");
  expect(ingestRequests).toEqual([]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(prompt).toBeHidden();
  expect(ingestRequests).toEqual([]);
});

test("accepting starts ingest, captures a route change, and does not ask again", async ({ page }) => {
  test.setTimeout(60_000);
  const ingestRequests = await prepareFirstVisit(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await prompt.getByRole("button", { name: "Allow" }).click();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBe("granted");
  await expect(prompt).toBeHidden();
  const pageviewPaths = () => ingestRequests
    .filter(({ event }) => event === "$pageview")
    .map(({ pathname }) => pathname);
  // PostHog is consent-lazy and loads its browser chunk only after this tap.
  // A cold production server under parallel Playwright workers can take longer
  // than the suite-wide 10s expectation budget without losing the pageview.
  await expect.poll(pageviewPaths, { timeout: 20_000 }).toContain("/");

  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect.poll(pageviewPaths).toContain("/privacy");

  await page.evaluate(() => {
    window.history.pushState(null, "", "/messages/private-thread");
  });
  await expect(page).toHaveURL(/\/messages\/private-thread$/);
  await expect.poll(pageviewPaths).toContain("/messages/[id]");
  expect(pageviewPaths()).not.toContain("/messages/private-thread");

  const firstMessagePageviewCount = pageviewPaths()
    .filter((pathname) => pathname === "/messages/[id]")
    .length;
  await page.evaluate(() => {
    window.history.pushState(null, "", "/messages/second-private-thread");
  });
  await expect.poll(() => pageviewPaths()
    .filter((pathname) => pathname === "/messages/[id]")
    .length).toBeGreaterThan(firstMessagePageviewCount);
  expect(pageviewPaths()).not.toContain("/messages/second-private-thread");

  await page.evaluate(() => {
    window.history.pushState(null, "", "/map");
  });
  await expect.poll(() => pageviewPaths()
    .filter((pathname) => pathname === "/map")
    .length).toBe(1);
  await page.evaluate(() => {
    window.history.pushState(null, "", "/admin");
  });
  await expect(page).toHaveURL(/\/admin$/);
  await page.evaluate(() => {
    window.history.pushState(null, "", "/map");
  });
  await expect.poll(() => pageviewPaths()
    .filter((pathname) => pathname === "/map")
    .length).toBe(2);
  expect(pageviewPaths()).not.toContain("/admin");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(prompt).toBeHidden();
});

test("rechecks consent when another prompt releases the budget", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFirstVisit(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pubmax:prompt-budget:v1", "identity-nudge");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
  await expect(prompt).toBeHidden();

  await page.evaluate(() => {
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    window.dispatchEvent(new Event("pubmax:prompt-budget"));
  });

  await expect(prompt).toBeVisible();
});

test("map prompt leaves the primary planning control usable", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFirstVisit(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  const planControl = page.getByRole("button", { name: "Describe the outing" });
  await expect(prompt).toBeVisible();
  await expect(planControl).toBeVisible({ timeout: 30_000 });

  const promptBox = await prompt.boundingBox();
  const controlBox = await planControl.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(
    Math.max(
      0,
      Math.min(promptBox!.y + promptBox!.height, controlBox!.y + controlBox!.height)
        - Math.max(promptBox!.y, controlBox!.y),
    ),
  ).toBe(0);

  await planControl.click();
  await expect(page.getByRole("heading", { name: "Describe the outing" })).toBeVisible();
});
