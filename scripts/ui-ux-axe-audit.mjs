import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  uiUxAuditContextOptions,
  uiUxChromiumLaunchOptions,
} from "./lib/uiUxBattleTestBrowser.mjs";
import {
  AUDITED_ROUTES,
  navigateToAuditedRoute,
} from "./lib/uiUxBattleTestNavigation.mjs";
import {
  buildUiUxAxeAuditDocument,
  validateUiUxAxeColorScheme,
} from "./lib/uiUxAxeAuditMetadata.mjs";

const output = process.env.UI_UX_AXE_OUTPUT ?? "/tmp/pubmax-ui-ux-battle-test/axe.json";
const origin = process.env.UI_UX_AXE_ORIGIN ?? "http://127.0.0.1:3000";
const colorScheme = validateUiUxAxeColorScheme(
  process.env.UI_UX_AXE_COLOR_SCHEME ?? "light",
);
const browserChannel = process.env.UI_UX_BROWSER_CHANNEL;
const viewports = [
  { name: "mobile-390", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: "desktop-1440", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch(uiUxChromiumLaunchOptions(browserChannel));
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({
    ...viewport,
    colorScheme,
    serviceWorkers: "block",
    ...uiUxAuditContextOptions(origin),
  });
  const page = await context.newPage();
  for (const route of AUDITED_ROUTES) {
    await navigateToAuditedRoute(page, origin, route);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    results.push({
      viewport: viewport.name,
      route: route.path,
      reducedMotion: await page.evaluate(() =>
        matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      violations: axe.violations.map(({ id, impact, description, help, nodes }) => ({
        id,
        impact,
        description,
        help,
        nodes: nodes.map((node) => ({ html: node.html, target: node.target })),
      })),
    });
  }
  await context.close();
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(
  output,
  JSON.stringify(buildUiUxAxeAuditDocument(origin, colorScheme, results), null, 2),
);
await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 5_000)),
]);
console.log(JSON.stringify({ output, colorScheme, routeCount: results.length, violationCount: results.reduce((sum, item) => sum + item.violations.length, 0) }, null, 2));
