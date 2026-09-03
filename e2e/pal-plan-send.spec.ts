import { expect, test, type Page } from "@playwright/test";

// Pal Plan send: Pub Pal crawl ask lands in Plan, auto-generates, locks, shares one link.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function askOnPhone(page: Page, ask: string) {
  await page.getByRole("textbox", { name: /Describe the outing/i }).fill(ask);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function futureLondonFirstPint(): Promise<string> {
  const when = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

async function dismissOnboarding(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
}

async function palToLockedPlan(page: Page) {
  await page.goto("/pal/chat");
  const ask = "Plan a crawl in Soho for 4";
  await askOnPhone(page, ask);
  const answer = page.locator(".palChatRow--pal").last();
  await answer.getByRole("link", { name: "Open in Plan" }).click();
  await expect(page).toHaveURL(/\/plan\?/);
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible({
    timeout: 30_000,
  });
  const nameField = page.getByLabel("Your name");
  if (await nameField.isVisible()) {
    const current = await nameField.inputValue();
    if (!current.trim()) await nameField.fill("Karan");
  }
  await page.getByLabel("First pint").fill(await futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);
}

for (const [label, viewport] of [
  ["phone 390px", PHONE],
  ["desktop", DESKTOP],
] as const) {
  test(`${label}: Pal crawl ask auto-plans and shares one invite link`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissOnboarding(page);
    await palToLockedPlan(page);
    await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toBeVisible();
    const copyButton = page.getByRole("button", { name: "Copy invite link" });
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.locator(".planHostInviteLink__status")).toHaveText("Invite link copied.");
  });
}
