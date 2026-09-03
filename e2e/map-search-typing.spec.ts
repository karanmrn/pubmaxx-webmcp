import { expect, test, type Page } from "@playwright/test";

// Typed map search used to destroy its own input. On the phone, after about
// two characters the debounce fired: one match flew to that pub through
// selectVenue, which drops the map overlay, so the field unmounted mid-word and
// the URL stuck at "?q=Qu". Several matches refitted the camera instead and
// threw the viewport out past the M25 while the reader was still typing.
//
// The contract: a reader types a whole pub name, the field keeps every
// character, and the camera does not move until the caret leaves it.

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const SESSION_KEY = "pubmaxx.mobile-map-session.v1";
const PHONE = { width: 390, height: 844 };
// Long enough to pass the two-character mark several times over, and to resolve
// to a single match on the way through — the shape that unmounted the field.
const PUB_NAME = "Ice Wharf";
// Comfortably past the 320ms typed-search debounce, so a move would have run
// between keystrokes if anything still armed one.
const KEY_DELAY_MS = 420;

// The phone chrome only mounts once the map canvas is ready, so this spec needs
// a real WebGL2 context. SwiftShader gives it one on a GPU-less box.
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

type Camera = { center: [number, number]; zoom: number } | null;

async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const viewport = (JSON.parse(raw) as { viewport?: { center: [number, number]; zoom: number } })
      .viewport;
    return viewport ? { center: viewport.center, zoom: viewport.zoom } : null;
  }, SESSION_KEY);
}

test("typing a whole pub name keeps the field and leaves the camera still", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await page.addInitScript(
    ({ consentKey, sessionKey }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem(consentKey, "denied");
      // A restored session would seed its own camera and query.
      window.localStorage.removeItem(sessionKey);
    },
    { consentKey: CONSENT_KEY, sessionKey: SESSION_KEY },
  );

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas, .mapCanvasWrap").first()).toBeVisible({
    timeout: 45_000,
  });
  await page.locator(".mapLoading").waitFor({ state: "hidden", timeout: 45_000 }).catch(() => {});

  await page.getByRole("button", { name: "Search the map" }).click();
  const field = page.locator("#mobileMapSearchInput");
  await expect(field).toBeFocused();

  // The camera as the reader starts typing.
  await expect.poll(() => readCamera(page), { timeout: 20_000 }).not.toBeNull();
  const before = await readCamera(page);
  expect(before).not.toBeNull();

  for (const character of PUB_NAME) {
    await field.press(character === " " ? "Space" : character, { delay: 20 });
    await page.waitForTimeout(KEY_DELAY_MS);
    // The field survives every keystroke, caret included.
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
  }

  // Every character the reader typed is still in the field.
  await expect(field).toHaveValue(PUB_NAME);
  // The overlay is still the search overlay, not a venue sheet.
  await expect(page.locator(".mobileMapSearchRow")).toBeVisible();
  // The URL carries the whole word, not the first two characters.
  expect(new URL(page.url()).searchParams.get("q")).toBe(PUB_NAME);

  const after = await readCamera(page);
  expect(after).not.toBeNull();
  expect(after?.zoom).toBeCloseTo(before?.zoom ?? 0, 5);
  expect(after?.center[0]).toBeCloseTo(before?.center[0] ?? 0, 5);
  expect(after?.center[1]).toBeCloseTo(before?.center[1] ?? 0, 5);
});
