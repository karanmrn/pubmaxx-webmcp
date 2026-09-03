import { expect, test, type Page } from "@playwright/test";

const DESKTOP_CASES = [
  { width: 1024, height: 768, theme: "light" },
  { width: 1024, height: 768, theme: "dark" },
  { width: 1280, height: 800, theme: "light" },
  { width: 1280, height: 800, theme: "dark" },
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1920, height: 1080, theme: "light" },
  { width: 1920, height: 1080, theme: "dark" },
] as const;

const SIGNED_OUT_FITTED_SELECTOR =
  ".messagesInboxPane .emptyStateTitle, .messagesInboxPane .emptyStateBody, .messagesInboxPane .authUser:not(.authUserNav), .messagesInboxPane .authOptions, .messagesInboxPane .authMagicLinkInput, .messagesInboxPane .authMagicLinkButton";

async function expectDesktopSplit(page: Page): Promise<void> {
  const split = page.locator(".messagesSplit");
  const inbox = page.locator(".messagesInboxPane");
  const thread = page.locator(".messagesThreadPane");

  await expect(split).toBeVisible();
  await expect(inbox).toBeVisible();
  await expect(thread).toBeVisible();
  await expect(inbox).toHaveCSS("min-width", "0px");
  await expect(thread).toHaveCSS("min-width", "0px");

  const [splitBox, inboxBox, threadBox] = await Promise.all([
    split.boundingBox(),
    inbox.boundingBox(),
    thread.boundingBox(),
  ]);
  expect(splitBox).not.toBeNull();
  expect(inboxBox).not.toBeNull();
  expect(threadBox).not.toBeNull();
  if (!splitBox || !inboxBox || !threadBox) return;

  expect(splitBox.width).toBeGreaterThan(900);
  expect(inboxBox.width).toBeGreaterThanOrEqual(300);
  expect(threadBox.width).toBeGreaterThan(500);
  expect(threadBox.x).toBeGreaterThan(inboxBox.x + inboxBox.width - 2);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

async function expectSignedOutCardFitsInbox(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: "Sign in to message" });
  const fitted = page.locator(SIGNED_OUT_FITTED_SELECTOR);

  await expect(heading).toBeVisible();
  await expect(fitted).toHaveCount(6);
  const geometry = await page.evaluate((fittedSelector) => {
    const inboxNode = document.querySelector<HTMLElement>(".messagesInboxPane");
    const cardNode = document.querySelector<HTMLElement>(".messagesInboxPane .emptyState");
    const fittedNodes = [
      ...document.querySelectorAll<HTMLElement>(fittedSelector),
    ];
    if (!inboxNode || !cardNode) return null;

    return {
      inboxRight: inboxNode.getBoundingClientRect().right,
      cardLeft: cardNode.getBoundingClientRect().left,
      cardRight: cardNode.getBoundingClientRect().right,
      cardFits: cardNode.scrollWidth <= cardNode.clientWidth,
      fitted: fittedNodes.map((node) => ({
        className: node.className,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
        fits: node.scrollWidth <= node.clientWidth,
      })),
    };
  }, SIGNED_OUT_FITTED_SELECTOR);

  expect(geometry).not.toBeNull();
  if (!geometry) return;
  expect(geometry.cardFits).toBe(true);
  const cardCenter = (geometry.cardLeft + geometry.cardRight) / 2;
  for (const item of geometry.fitted) {
    expect(item.fits, `${item.className} should fit its own box`).toBe(true);
    expect(item.right, `${item.className} should stay inside card`).toBeLessThanOrEqual(
      geometry.cardRight + 1,
    );
    expect(item.right, `${item.className} should stay inside inbox`).toBeLessThanOrEqual(
      geometry.inboxRight + 1,
    );
    expect(
      Math.abs((item.left + item.right) / 2 - cardCenter),
      `${item.className} should share card centre line`,
    ).toBeLessThanOrEqual(1);
  }
}

async function expectSignedOutProfileAuthFitsPane(page: Page): Promise<void> {
  await page.goto("/u/testdrinker");

  const pane = page.locator(".profileIdentityPane");
  const authRoot = pane.locator(".profileMessageSignIn .authUser:not(.authUserNav)");
  const fitted = pane.locator(
    ".profileMessageSignIn .authUser:not(.authUserNav), .profileMessageSignIn .authOptions, .profileMessageSignIn .authMagicLinkInput, .profileMessageSignIn .authMagicLinkButton",
  );

  await expect(pane).toBeVisible();
  await expect(authRoot).toBeVisible();
  await expect(authRoot).toHaveCSS("min-width", "0px");
  await expect(authRoot).toHaveCSS("max-width", "100%");
  await expect(fitted).toHaveCount(4);

  const geometry = await page.evaluate(() => {
    const paneNode = document.querySelector<HTMLElement>(".profileIdentityPane");
    const actionNode = document.querySelector<HTMLElement>(
      ".profileIdentityPane .profileActions",
    );
    const fittedNodes = [
      ...document.querySelectorAll<HTMLElement>(
        ".profileIdentityPane .profileMessageSignIn .authUser:not(.authUserNav), .profileIdentityPane .profileMessageSignIn .authOptions, .profileIdentityPane .profileMessageSignIn .authMagicLinkInput, .profileIdentityPane .profileMessageSignIn .authMagicLinkButton",
      ),
    ];
    if (!paneNode || !actionNode) return null;

    return {
      paneLeft: paneNode.getBoundingClientRect().left,
      paneRight: paneNode.getBoundingClientRect().right,
      actionLeft: actionNode.getBoundingClientRect().left,
      actionRight: actionNode.getBoundingClientRect().right,
      fitted: fittedNodes.map((node) => ({
        className: node.className,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
        fits: node.scrollWidth <= node.clientWidth,
      })),
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) return;
  for (const item of geometry.fitted) {
    expect(item.fits, `${item.className} should fit its own box`).toBe(true);
    expect(item.left, `${item.className} should stay inside actions`).toBeGreaterThanOrEqual(
      geometry.actionLeft - 1,
    );
    expect(item.right, `${item.className} should stay inside actions`).toBeLessThanOrEqual(
      geometry.actionRight + 1,
    );
    expect(item.left, `${item.className} should stay inside profile pane`).toBeGreaterThanOrEqual(
      geometry.paneLeft - 1,
    );
    expect(item.right, `${item.className} should stay inside profile pane`).toBeLessThanOrEqual(
      geometry.paneRight + 1,
    );
  }
}

for (const viewport of DESKTOP_CASES) {
  test(`messages use inbox and thread panes at ${viewport.width}px in ${viewport.theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((theme) => {
      window.localStorage.setItem("pubmax-theme", theme);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_handle", "messages-layout-viewer");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, viewport.theme);

    await page.goto("/messages");
    if (viewport.theme === "dark") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } else {
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    }
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    // This case is SIGNED OUT (expectSignedOutCardFitsInbox below), and the
    // thread pane reads the live session now: it may not tell somebody with no
    // account to choose from an inbox they cannot have.
    await expect(
      page.getByRole("heading", { name: "Your conversations show here." }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pick a message" })).toHaveCount(0);
    await expect(page.locator(".messagesThreadEyebrow")).toHaveCSS("text-transform", "none");
    await expectDesktopSplit(page);
    await expectSignedOutCardFitsInbox(page);

    await page.goto("/messages/nonexistent");
    await expect(page.getByText(/sign in to read and send messages/i)).toBeVisible();
    await expectDesktopSplit(page);

    await expectSignedOutProfileAuthFitsPane(page);
  });
}
