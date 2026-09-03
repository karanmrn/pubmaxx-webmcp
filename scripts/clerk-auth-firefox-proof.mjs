#!/usr/bin/env node
/**
 * Firefox browser proof for Clerk account journey.
 *
 * Playwright Firefox only (chrome-devtools-axi writes no files; Zen undrivable).
 * Screenshots land in docs/proof/clerk-auth/.
 *
 * Instance note (rare-trout-29 development):
 * user_settings.sign_up.mode is "waitlist". The Create account control therefore
 * opens Clerk's waitlist dialog — that is instance config, not an app defect.
 * Open self-serve sign-up is not available until waitlist is turned off in the
 * Clerk dashboard. This proof:
 *   1) shows signed-out + Create account waitlist (honest)
 *   2) creates a real user via the Backend API (allowed under waitlist)
 *   3) signs in with the development +clerk_test email OTP 424242
 *   4) signs out
 *   5) signs back in
 *
 * Usage: node scripts/clerk-auth-firefox-proof.mjs [baseUrl]
 * Default baseUrl: http://localhost:3127
 */

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { firefox } = await import("playwright-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "proof", "clerk-auth");
const BASE = process.argv[2] || "http://localhost:3127";
const OTP = "424242";

function loadEnvLocal() {
  try {
    const text = require("node:fs").readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

async function clerkApi(secret, method, apiPath, body) {
  const res = await fetch(`https://api.clerk.com/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "pubmax-clerk-proof",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${apiPath} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return data;
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log("shot", name);
  return file;
}

async function openSignInMenu(page) {
  const trigger = page.getByRole("button", { name: /^Sign in$/i }).first();
  await trigger.waitFor({ state: "visible", timeout: 60_000 });
  for (let i = 0; i < 4; i++) {
    await trigger.click();
    try {
      await page.getByRole("button", { name: /Create account/i }).waitFor({
        state: "visible",
        timeout: 4_000,
      });
      return;
    } catch {
      // retry
    }
  }
  await page.getByRole("button", { name: /Create account/i }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function isSignedIn(page) {
  if (await page.getByText("Signed in to your PUBMAXX account").count()) {
    if (
      await page
        .getByText("Signed in to your PUBMAXX account")
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      return true;
    }
  }
  const btn = await userButton(page);
  if (await btn.count()) {
    return btn.isVisible().catch(() => false);
  }
  return false;
}

async function waitSignedIn(page) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    // Modal may linger after password submit and block the nav.
    if (await page.locator(".cl-modalBackdrop").count()) {
      await dismissClerkModal(page);
    }
    // Compact host keeps UserButton inside the open menu.
    const trigger = page.getByRole("button", { name: /^Sign in$/i });
    if (await trigger.count()) {
      const expanded = await trigger.first().getAttribute("aria-expanded");
      if (expanded !== "true") {
        await trigger.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }
    if (await isSignedIn(page)) {
      // Leave the menu open for the signed-in screenshot.
      return;
    }
    await page.waitForTimeout(800);
  }
  throw new Error("timed out waiting for signed-in UI");
}

async function userButton(page) {
  // Clerk v7 ships several class names for the avatar trigger.
  return page
    .locator(
      [
        ".cl-userButtonTrigger",
        "button.cl-userButtonTrigger",
        ".cl-userButtonBox button",
        ".cl-avatarBox",
        "[data-clerk-component='UserButton'] button",
        ".clerkAccount .cl-userButtonTrigger",
        ".clerkAccount button",
      ].join(", "),
    )
    .first();
}

async function signOut(page) {
  if (await page.locator(".cl-modalBackdrop").count()) {
    await dismissClerkModal(page);
  }

  // Prefer Clerk's browser SDK signOut — the compact host keeps UserButton
  // inside a closed menu, so clicking the avatar is flaky under automation.
  const viaSdk = await page.evaluate(async () => {
    const clerk = window.Clerk;
    if (!clerk?.signOut) return { ok: false, reason: "no Clerk.signOut" };
    try {
      await clerk.signOut();
      return { ok: true, reason: "sdk" };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });
  console.log("signOut", viaSdk);

  if (!viaSdk.ok) {
    // Fallback: open compact menu and click UserButton → Sign out.
    const trigger = page.getByRole("button", { name: /^Sign in$/i });
    if (await trigger.count()) {
      await trigger.first().click({ force: true });
      await page.waitForTimeout(600);
    }
    const btn = page.locator(".cl-userButtonTrigger, button.cl-userButtonTrigger").first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click({ force: true });
    const signOutBtn = page
      .locator(".cl-userButtonPopoverActionButton, button, [role='menuitem']")
      .filter({ hasText: /Sign out/i })
      .first();
    await signOutBtn.waitFor({ state: "visible", timeout: 15_000 });
    await signOutBtn.click({ force: true });
  }

  // Wait until the signed-out Create account control is available again.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.locator(".cl-modalBackdrop").count()) {
      await dismissClerkModal(page);
    }
    // Reload once so ClientClerkProvider fully drops the session chrome.
    if (Date.now() + 30_000 < deadline && !(await page.getByText("Create account").count())) {
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    try {
      await openSignInMenu(page);
      if (await page.getByRole("button", { name: /Create account/i }).isVisible()) {
        return;
      }
    } catch {
      // retry
    }
    await page.waitForTimeout(800);
  }
  throw new Error("timed out waiting for signed-out UI after sign-out");
}

async function dismissClerkModal(page) {
  // Prefer the explicit close control; Escape as fallback.
  const close = page.locator(
    'button.cl-modalCloseButton, button[aria-label="Close modal"], button[aria-label="Close"]',
  ).first();
  if (await close.count()) {
    await close.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press("Escape");
  }
  await page
    .locator(".cl-modalBackdrop")
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function signInWithPassword(page, email, password) {
  // Never leave a previous Clerk modal covering the page.
  if (await page.locator(".cl-modalBackdrop").count()) {
    await dismissClerkModal(page);
  }
  await openSignInMenu(page);
  await page.getByRole("button", { name: /Sign in with a PUBMAXX account/i }).click();

  const modal = page.locator(".cl-modalContent, .cl-card, [role='dialog']").first();
  await modal.waitFor({ state: "visible", timeout: 45_000 });

  const emailInput = modal.locator('input[name="identifier"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);

  // This instance's sign-in form shows email + password together.
  const passwordInput = modal.locator('input[name="password"][type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
  await passwordInput.fill(password);

  // Exact "Continue" — not "Continue with Google".
  const continueBtn = modal.getByRole("button", { name: /^Continue$/i });
  await continueBtn.click();

  // Optional email-code step (development +clerk_test OTP).
  const otp = page
    .locator(
      'input[name="code"], input[autocomplete="one-time-code"], input.cl-otpCodeFieldInput, input[inputmode="numeric"]',
    )
    .first();
  try {
    await otp.waitFor({ state: "visible", timeout: 8_000 });
    await otp.fill(OTP);
    const verify = page
      .locator(".cl-modalContent button, .cl-card button, [role='dialog'] button")
      .filter({ hasText: /^(Continue|Verify|Submit)$/i })
      .first();
    if (await verify.count()) {
      await verify.click();
    }
  } catch {
    // Password-only path — no OTP step.
  }
  await waitSignedIn(page);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const env = loadEnvLocal();
  const secret = env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY missing from .env.local");

  const stamp = Date.now().toString(36);
  const email = `pubmax.crew+clerk_test_${stamp}@example.com`;
  const password = `Pubmax-Clerk-${stamp}-9!`;

  // Backend-created user (waitlist blocks open self-serve sign-up).
  const user = await clerkApi(secret, "POST", "/users", {
    email_address: [email],
    password,
    skip_password_checks: true,
  });
  console.log("user", user.id);
  console.log("email", email);

  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // 1) Signed out
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await openSignInMenu(page);
  await shot(page, "01-signed-out.png");

  // 2) Create account -> waitlist (instance config)
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, "02-sign-up-waitlist.png");
  await dismissClerkModal(page);

  // 3) Sign in with the API-created account
  await signInWithPassword(page, email, password);
  await shot(page, "03-signed-in.png");

  // 4) Sign out
  await signOut(page);
  await shot(page, "04-signed-out-again.png");

  // 5) Sign back in
  await signInWithPassword(page, email, password);
  await shot(page, "05-signed-in-again.png");

  const report = {
    base: BASE,
    email,
    userId: user.id,
    note:
      "Instance sign_up.mode=waitlist so Create account shows the waitlist. User created via Backend API; browser sign-in uses email+password (and OTP if shown).",
    shots: [
      "01-signed-out.png",
      "02-sign-up-waitlist.png",
      "03-signed-in.png",
      "04-signed-out-again.png",
      "05-signed-in-again.png",
    ],
    consoleErrors: consoleErrors.slice(0, 30),
    at: new Date().toISOString(),
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("report", JSON.stringify(report, null, 2));
  await browser.close();
  console.log("OK");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exitCode = 1;
});
