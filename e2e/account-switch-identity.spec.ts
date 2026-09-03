import { expect, test, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  DEVICE_ACCOUNTS_KEY,
  decodeResumeCookie,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
  resumeCookie,
  seedSignedIn,
  type Stub,
} from "./helpers/authDoubles";

// The signed-in account is the ONLY identity authority.
//
// DEFECT: a drinker signed out of account A (@karan) and created account B
// (@karansznx) in the same browser. Sign-out never cleared the device identity
// artifacts, and nothing on an account CHANGE cleared them either, so A's
// `pubmax_handle` outlived A's session and every surface reading it - the You
// tab, the profile route, the follow actor - still answered "@karan".
//
// The keyless Playwright server has no Supabase, so the session and the
// owner-only reads are browser route doubles. Every surface under test is the
// real shipped UI, and the durable resume cookie is the REAL route.

const SHOTS = "/tmp/pubmax-account-switch";



/** Put both accounts in the lane by signing each of them in, in turn. */
async function seedBothAccounts(page: Page, stub: Stub, landing: string): Promise<void> {
  await seedSignedIn(page, "A");
  await page.goto(landing);
  await expect
    .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
    .toBe(ACCOUNTS.A.handle);

  await stub.signedInAs("B");
  await page.goto(landing);
  await expect
    .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
    .toBe(ACCOUNTS.B.handle);
  await expect
    .poll(async () => (await readDeviceAccounts(page)).length, { timeout: 10_000 })
    .toBe(2);
}

/**
 * Open the nav account card, or leave it open. The trigger is a toggle, so a
 * second click on an already-open menu would close it.
 */
async function openAccountMenu(page: Page): Promise<void> {
  const menu = page.locator(".authAccountMenu");
  if (!(await menu.isVisible())) {
    await page.getByRole("button", { name: /Account options/ }).first().click();
  }
  await expect(menu).toBeVisible();
}

/** Open the switcher list inside whichever account surface is on screen. */
async function openSwitcher(page: Page): Promise<void> {
  const list = page.locator(".authSwitcherList");
  if (!(await list.isVisible())) {
    await page.getByRole("button", { name: "Switch account" }).click();
  }
  await expect(list).toBeVisible();
}



function youLink(page: Page) {
  // A Next transition can retain the outgoing layout briefly. Read current
  // visible navigation, not the first link in that transient tree.
  return page
    .locator('nav[aria-label="Primary"]:visible')
    .getByRole("link", { name: "You", exact: true })
    .last();
}

async function expectYouDestination(page: Page, handle: string): Promise<void> {
  await youLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
}

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test.describe("account switch on one device", () => {
  test("a second account owns the device the moment it signs in", async ({ page }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedSignedIn(page, "A");

    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);
    await expectYouDestination(page, ACCOUNTS.A.handle);
    // The durable resume cookie is written by the real route, off the render
    // path, so poll rather than assume it landed with the first paint.
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 10_000,
      })
      .toBe(ACCOUNTS.A.refreshToken);

    // The founder's flow: sign out, then sign up as a second account in the
    // same browser. A's device artifacts must not survive B's arrival.
    await stub.signedInAs("B");
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.B.handle);
    await expectYouDestination(page, ACCOUNTS.B.handle);
    await page.screenshot({ path: `${SHOTS}/3-switched-to-b.png` });

    // Every surface that NAMES the viewer, not only the ones that route them.
    // The Today greeting read the device handle straight from storage and kept
    // saying "Good afternoon, karan" over the second account's whole visit.
    await page.goto("/today");
    // `.first()`: the outgoing tree can still be mounted for a beat after a
    // navigation, and this assertion is about the WORDS in the greeting.
    await expect(page.getByTestId("today-greeting").first()).toBeVisible();
    // A word boundary, because "karansznx" contains "karan": the point is that
    // the greeting names B, not that the letters never appear.
    await expect
      .poll(async () => page.getByTestId("today-greeting").first().innerText(), {
        timeout: 10_000,
      })
      .not.toMatch(new RegExp(`\\b${ACCOUNTS.A.handle}\\b`));

    // B's durable resume cookie replaced A's.
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 10_000,
      })
      .toBe(ACCOUNTS.B.refreshToken);
  });

  test("a second account with no handle yet is never called by the first one's name", async ({
    page,
  }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    // B exists but has claimed nothing. The stale handle must go anyway - an
    // unclaimed account owed a claim step is the case the old short-circuit
    // silently skipped.
    await stub.signedInAs("B");
    stub.setServerHandle(null);
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBeNull();
    await expect(youLink(page)).toHaveAttribute("href", "/u/you");
    await page.screenshot({ path: `${SHOTS}/5-unclaimed-b.png` });
  });
});

test.describe("account switch on a desktop viewport", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sign-out clears every device identity artifact", async ({ page }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedSignedIn(page, "A");

    // /social rather than /today: a Today card holds `opacity` below 1 while its
    // reveal animation runs, which makes that card a stacking context painting
    // over the nav popover. That is a real defect on /today and its own repair;
    // it is not the identity contract this spec is about.
    await page.goto("/social");
    await page.waitForLoadState("domcontentloaded");
    // The canonical read lands and owns the device handle.
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    // Device-only artifacts the previous account left behind.
    await page.evaluate(() => {
      window.localStorage.setItem("pubmax_round_anonymous_identity_v1", "karan");
      window.localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
    });

    await page.screenshot({ path: `${SHOTS}/1-signed-in-as-a.png` });

    await stub.signedInAs(null);
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await page
      .locator(".authAccountMenu")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBeNull();
    const after = await readDeviceIdentity(page);
    expect(after.roundAnonymous).toBeNull();
    expect(after.nudgePending).toBeNull();
    await expect.poll(() => resumeCookie(page), { timeout: 10_000 }).toBeFalsy();
    await page.screenshot({ path: `${SHOTS}/2-signed-out.png` });
  });

  test("the desktop account menu follows the live session", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/today");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.A.handle);

    await stub.signedInAs("B");
    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 10_000 })
      .toBe(ACCOUNTS.B.handle);
    await page.screenshot({ path: `${SHOTS}/6-desktop-switched.png` });

    // The account card names B, never A.
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await expect(page.getByText(`@${ACCOUNTS.B.handle}`).first()).toBeVisible();
    await expect(page.getByText(`@${ACCOUNTS.A.handle}`, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/7-desktop-account-card-b.png` });

    // No link on the page still points at the previous account's profile.
    const hrefs = await page
      .locator('a[href^="/u/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(
      hrefs.filter((href) => href.split(/[?#]/)[0] === `/u/${ACCOUNTS.A.handle}`),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The switcher. A person running two accounts hops between them from the nav
// card, and every hop is the SAME atomic swap a fresh sign-in performs: one
// account owns the device artifacts at a time, and the switcher only ever
// changes which session is active.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("switching between two accounts on one device", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the device remembers both accounts, and each keeps its own token", async ({
    page,
  }) => {
    const stub = await installAuthDoubles(page);
    await seedBothAccounts(page, stub, "/social");

    const remembered = await readDeviceAccounts(page);
    expect(remembered.map((row) => row.handle).sort()).toEqual([
      ACCOUNTS.A.handle,
      ACCOUNTS.B.handle,
    ]);
    // One refresh token per account, and no access token anywhere: an access
    // token is minutes long and a switch has no use for one.
    expect(
      remembered.find((row) => row.userId === ACCOUNTS.A.id)?.refreshToken,
    ).toBe(ACCOUNTS.A.refreshToken);
    expect(
      remembered.find((row) => row.userId === ACCOUNTS.B.id)?.refreshToken,
    ).toBe(ACCOUNTS.B.refreshToken);
    const raw = await page.evaluate(
      (key) => window.localStorage.getItem(key) ?? "",
      DEVICE_ACCOUNTS_KEY,
    );
    expect(raw).not.toContain("access-token");
  });

  test("one tap swaps every artifact, and leaks nothing of the account left behind", async ({
    page,
  }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedBothAccounts(page, stub, "/social");

    await openAccountMenu(page);
    await openSwitcher(page);
    const row = page.locator(".authSwitcherList .authSwitcherRow");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`@${ACCOUNTS.A.handle}`);
    await page.screenshot({ path: `${SHOTS}/8-switcher-open.png` });

    await row.click();

    // The device identity is A's the moment the session is, and B's handle is
    // gone rather than left for A to be called by.
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);
    // The card under the switch now names A. It is the same open menu, so a card
    // held from before the switch would still be showing B here.
    const card = page.locator(".authAccountCard");
    await expect(card).toContainText(`@${ACCOUNTS.A.handle}`);
    // The CARD is about one account. B may name itself in the switch list, which
    // is the point of the list, and nowhere else.
    await expect(card).not.toContainText(ACCOUNTS.B.handle);
    await expect(
      page.getByRole("button", { name: `Sign out of @${ACCOUNTS.A.handle}` }),
    ).toBeVisible();

    // The durable resume cookie mirrors the ACTIVE account only, and it holds
    // the ROTATED token, because GoTrue spends a refresh token on use.
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 15_000,
      })
      .toBe(`${ACCOUNTS.A.refreshToken}-rotated`);

    // B is still on this device, still holding its own untouched token.
    await expect
      .poll(async () => {
        const rows = await readDeviceAccounts(page);
        return rows.find((entry) => entry.userId === ACCOUNTS.B.id)?.refreshToken;
      }, { timeout: 15_000 })
      .toBe(ACCOUNTS.B.refreshToken);

    // No surface still ROUTES to the account we left, on the page the switch
    // happened on. This is the strict case: nothing reloaded, so a link still
    // pointing at B would be a component that never re-read the live session -
    // the defect the You tab and the Today greeting each had once.
    const leaked = await page
      .locator('a[href^="/u/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(
      leaked.filter((href) => href.split(/[?#]/)[0] === `/u/${ACCOUNTS.B.handle}`),
    ).toEqual([]);
    expect(leaked).toContain(`/u/${ACCOUNTS.A.handle}`);

    // And again after a full load. The init script re-seeds a session on every
    // load, so the stub is told who owns the device now; without that the next
    // navigation would sign B straight back in and prove nothing.
    await stub.signedInAs("A");
    await page.goto("/social");
    await page.waitForLoadState("domcontentloaded");
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);
    const hrefs = await page
      .locator('a[href^="/u/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(
      hrefs.filter((href) => href.split(/[?#]/)[0] === `/u/${ACCOUNTS.B.handle}`),
    ).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/9-switched-back-to-a.png` });
  });

  test("a refused token leaves the account listed as needing sign-in", async ({
    page,
  }) => {
    const stub = await installAuthDoubles(page);
    await seedBothAccounts(page, stub, "/social");

    // A's stored refresh token is dead, which GoTrue answers as a 4xx. The token
    // is retired and the row stays: "we cannot let you back in silently" is a
    // different answer from "you were never here".
    await page.evaluate(
      ({ key, userId }) => {
        const rows = JSON.parse(window.localStorage.getItem(key) ?? "[]") as Array<{
          userId: string;
          refreshToken: string | null;
        }>;
        window.localStorage.setItem(
          key,
          JSON.stringify(
            rows.map((row) =>
              row.userId === userId ? { ...row, refreshToken: "dead-token-abcdef" } : row,
            ),
          ),
        );
      },
      { key: DEVICE_ACCOUNTS_KEY, userId: ACCOUNTS.A.id },
    );
    await page.reload();

    await openAccountMenu(page);
    await openSwitcher(page);
    await page.locator(".authSwitcherList .authSwitcherRow").click();

    await expect
      .poll(async () => {
        const rows = await readDeviceAccounts(page);
        return rows.find((entry) => entry.userId === ACCOUNTS.A.id)?.refreshToken;
      }, { timeout: 15_000 })
      .toBeNull();
    // The session that was live is untouched: only a successful mint is ever
    // installed, so a dead token on the account being switched TO can never sign
    // anyone out of the account they are switching FROM.
    expect((await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);

    // Still the same open list: the lane changed under it, so the row re-reads
    // itself rather than waiting for a reload.
    await expect(page.locator(".authSwitcherList")).toContainText("Signed out");
    await page.screenshot({ path: `${SHOTS}/10-switcher-needs-sign-in.png` });
  });

  test("signing out of this account hands the device to the other one", async ({
    page,
  }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedBothAccounts(page, stub, "/social");

    await openAccountMenu(page);
    await page
      .locator(".authAccountMenu")
      .getByRole("button", { name: `Sign out of @${ACCOUNTS.B.handle}` })
      .click();

    // B leaves with its token; A was still signed in here, so the device is not
    // empty and must not be left as though it were.
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);
    await expect
      .poll(async () => (await readDeviceAccounts(page)).map((row) => row.userId), {
        timeout: 15_000,
      })
      .toEqual([ACCOUNTS.A.id]);
    await expect
      .poll(async () => decodeResumeCookie(await resumeCookie(page))?.rt, {
        timeout: 15_000,
      })
      .toBe(`${ACCOUNTS.A.refreshToken}-rotated`);
    await page.screenshot({ path: `${SHOTS}/11-signed-out-of-one.png` });
  });

  test("signing out of all accounts empties the device", async ({ page }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedBothAccounts(page, stub, "/social");
    await stub.signedInAs(null);

    await openAccountMenu(page);
    await page
      .locator(".authAccountMenu")
      .getByRole("button", { name: "Sign out of all accounts" })
      .click();

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBeNull();
    await expect
      .poll(async () => (await readDeviceAccounts(page)).length, { timeout: 15_000 })
      .toBe(0);
    await expect.poll(() => resumeCookie(page), { timeout: 15_000 }).toBeFalsy();
    await page.screenshot({ path: `${SHOTS}/12-signed-out-of-all.png` });
  });

  test("Add account opens the ordinary sign-in page with its form", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedBothAccounts(page, stub, "/social");

    await openAccountMenu(page);
    await openSwitcher(page);
    await page.getByRole("link", { name: "Add account" }).click();

    await expect(page).toHaveURL(/\/login\?add=1/);
    // A live session normally meets the "you are signed in" card here, which
    // would be a dead end for somebody who came to add a second account.
    await expect(page.getByRole("heading", { name: "Add another account" })).toBeVisible();
    await expect(page.locator(".authMagicLink")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/13-add-account.png` });
  });
});

test.describe("switching accounts on a phone", () => {
  // The nav account card is desktop only (`.siteNavBar .authUser` is hidden at
  // 640px), so /login's signed-in card is the account home on a phone and
  // carries the same controls. File-level `test.use` already sets 390px.
  test("the signed-in card on /login is the same switcher", async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await seedBothAccounts(page, stub, "/today");

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();

    await openSwitcher(page);
    const row = page.locator(".authSwitcherList .authSwitcherRow");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`@${ACCOUNTS.A.handle}`);
    // Every row is a real thumb target, like every other row in this card.
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/14-phone-switcher.png` });

    await row.click();

    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);
    // The two accounts have swapped roles: B is now the one to switch TO, and it
    // is the ONLY row, which says A left the list without asking whether
    // "@karan" appears inside "@karansznx".
    await openSwitcher(page);
    const swapped = page.locator(".authSwitcherList .authSwitcherRow");
    await expect(swapped).toHaveCount(1);
    await expect(swapped).toContainText(`@${ACCOUNTS.B.handle}`);
    await expect(
      page.getByRole("button", { name: `Sign out of @${ACCOUNTS.A.handle}` }),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/15-phone-switched.png` });
  });

  test("the way out is scoped on a phone too", async ({ page }) => {
    // Asserts the durable resume cookie, so it takes the real route.
    const stub = await installAuthDoubles(page, { realResumeCookie: true });
    await seedBothAccounts(page, stub, "/today");
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: `Sign out of @${ACCOUNTS.B.handle}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign out of all accounts" }),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/16-phone-sign-out-scope.png` });

    await page.getByRole("button", { name: "Sign out of all accounts" }).click();

    await expect
      .poll(async () => (await readDeviceAccounts(page)).length, { timeout: 15_000 })
      .toBe(0);
    await expect.poll(() => resumeCookie(page), { timeout: 15_000 }).toBeFalsy();
  });
});
