// One-shot capture for the near-me patch answer (denied state + open picker),
// both themes at 390x844. Runs against a `next start` server the caller owns.
import { chromium } from "playwright";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:3311";
const out = (name) => `docs/screenshots/${name}.png`;

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: theme,
    // No geolocation permission granted: getCurrentPosition rejects with
    // PERMISSION_DENIED — exactly the owner's screenshot state.
    permissions: [],
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/near`, { waitUntil: "networkidle" });
  await page.waitForSelector(".nmnCard", { timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out(`nearme-patch-${theme}-390`) });

  await page.click("text=Change area");
  await page.waitForTimeout(350);
  await page.screenshot({ path: out(`nearme-picker-${theme}-390`) });
  await context.close();
}
await browser.close();
console.log("captured 4 screenshots");
