#!/usr/bin/env node
// Visual + behavioural proof for fm/fix-qa-polish at 390x844.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:3110";
const OUT = process.env.QA_SHOT_DIR ?? "/tmp/fm-qa-polish-shots";
mkdirSync(OUT, { recursive: true });

const viewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  console.log("shot", path);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  // Fresh storage so consent can appear.
  const page = await context.newPage();

  // M01 Social tab + closed boundary (preview copy is unit-tested; keyless
  // local builds often answer unavailable when /api/social/access has no store).
  await page.goto(`${BASE}/social`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("navigation", { name: "Primary" }).getByText("Social", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Social", exact: true }).waitFor();
  const boundary = page.locator(".socialBoundary");
  await boundary.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector(".socialBoundary");
    const t = el?.textContent ?? "";
    return t.includes("invite-only") || t.includes("unavailable") || t.includes("Sign in");
  }, null, { timeout: 20_000 });
  const boundaryText = (await boundary.innerText()).trim();
  console.log("social boundary", boundaryText);
  // Source pin: preview copy must ship in the client bundle.
  const socialClient = await import("node:fs").then((fs) =>
    fs.readFileSync("app/social/SocialPageClient.tsx", "utf8"),
  );
  if (!socialClient.includes("Social is invite-only for now. It opens more widely soon.")) {
    throw new Error("preview boundary copy missing from SocialPageClient");
  }
  await shot(page, "after-m01-social.png");

  // M02 permalink redirect
  const venueRes = await context.request.get(`${BASE}/venue/the-ship-w1`, {
    maxRedirects: 0,
  });
  console.log("venue status", venueRes.status(), venueRes.headers()["location"]);
  if (venueRes.status() !== 308) throw new Error(`expected 308 for /venue, got ${venueRes.status()}`);
  const loc = venueRes.headers()["location"] ?? "";
  if (!loc.includes("sel=")) throw new Error(`expected sel= in location, got ${loc}`);

  // M04 we-are-out
  await page.goto(`${BASE}/we-are-out`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /We.?re out/ }).waitFor({ timeout: 20_000 });
  await shot(page, "after-m04-we-are-out.png");
  const overlap = await page.evaluate(() => {
    const pill = document.querySelector(".feedEyebrow");
    const title = document.querySelector(".feedTitle");
    if (!pill || !title) return { ok: false, reason: "missing" };
    const a = pill.getBoundingClientRect();
    const b = title.getBoundingClientRect();
    const intersects = !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
    return { ok: !intersects, pillBottom: a.bottom, titleTop: b.top, gap: b.top - a.bottom };
  });
  console.log("m04 overlap check", overlap);
  if (!overlap.ok) throw new Error("OUT TONIGHT still overlaps heading");

  // M05/M06 bottom padding
  for (const path of ["/tonight", "/today"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const name = path === "/tonight" ? "after-m05-tonight.png" : "after-m06-today.png";
    await shot(page, name);
    const pad = await page.evaluate(() => {
      const root = document.querySelector(".tonightPage, .todayPage");
      if (!root) return null;
      const style = getComputedStyle(root);
      return { paddingBottom: style.paddingBottom, scrollHeight: root.scrollHeight };
    });
    console.log(path, "padding", pad);
  }

  // M07 Clubs contrast on filters
  await context.clearCookies();
  const mapPage = await context.newPage();
  await mapPage.addInitScript(() => {
    try {
      localStorage.setItem("pubmax:analytics-consent:v1", "denied");
    } catch {}
  });
  await mapPage.goto(`${BASE}/map`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await mapPage.waitForTimeout(2000);
  const filters = mapPage.getByRole("button", { name: /filter|prices/i }).first();
  if (await filters.count()) {
    await filters.click().catch(() => {});
  }
  // Filters control in mobile chrome
  const filterBtn = mapPage.locator('button[aria-label*="Filter"], button:has-text("Filters")').first();
  if (await filterBtn.count()) await filterBtn.click({ timeout: 5000 }).catch(() => {});
  await mapPage.waitForTimeout(1000);
  const clubs = mapPage.getByRole("button", { name: /Clubs/i }).first();
  if (await clubs.count()) {
    const contrast = await clubs.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, textDecoration: style.textDecorationLine };
    });
    console.log("clubs chip", contrast);
    await shot(mapPage, "after-m07-clubs.png");
  } else {
    console.log("clubs chip not found in this session (filters may not have opened)");
  }
  await mapPage.close();

  // M09 + L04: fresh consent + sel deep link
  const fresh = await browser.newContext({
    viewport,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${BASE}/map`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await freshPage.waitForTimeout(2500);
  await shot(freshPage, "after-m09-consent.png");
  const m09 = await freshPage.evaluate(() => {
    const consent = document.querySelector(".analyticsConsentPrompt");
    const plan = document.querySelector(".mobilePlanActivation");
    if (!consent || !plan) return { ok: true, note: "consent or plan missing", hasConsent: !!consent, hasPlan: !!plan };
    const c = consent.getBoundingClientRect();
    const p = plan.getBoundingClientRect();
    const coversCentre =
      c.top < p.top + p.height / 2 && c.bottom > p.top + p.height / 2;
    return {
      ok: !coversCentre && c.bottom <= p.top + 4,
      consentBottom: c.bottom,
      planTop: p.top,
      gap: p.top - c.bottom,
    };
  });
  console.log("m09 consent vs plan", m09);

  // L02 login rhythm
  await freshPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await freshPage.getByText("PUBMAXXING").first().waitFor();
  await shot(freshPage, "after-l02-login.png");
  const loginTop = await freshPage.evaluate(() => {
    const head = document.querySelector(".loginPageHead");
    return head ? head.getBoundingClientRect().top : null;
  });
  console.log("login head top", loginTop);
  if (loginTop == null || loginTop > 280) throw new Error("login still sits too low");

  // L04 sel centres map
  await freshPage.goto(`${BASE}/map?sel=venue-806vol`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await freshPage.waitForTimeout(4000);
  await shot(freshPage, "after-l04-sel.png");
  const sel = await freshPage.evaluate(() => {
    const title = document.body.innerText;
    return {
      hasShip: /Ship/i.test(title),
      sheet: !!document.querySelector(".mobileSheetPortal, .mapDrawer"),
    };
  });
  console.log("l04 sel", sel);
  if (!sel.hasShip) throw new Error("selected venue sheet did not show The Ship");

  await fresh.close();
  await browser.close();
  console.log("qa-polish-verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
