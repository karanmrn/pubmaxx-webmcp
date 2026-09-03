import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// The profile hero's rendered geometry, which is the only place the redesign is
// actually true. The CSS is fenced in __tests__/profileRichRender.test.ts; this
// measures what a browser lays out.
//
// FOUR things this proves.
//
// 1. THE COVER IS A BANNER BAND AT THE CARD'S OWN WIDTH, and its rendered
//    aspect ratio is the CROPPER's (3:1). That equality is the point: a band
//    with a fixed height over a fluid width shows a different rectangle at
//    every viewport, which is how a photograph somebody framed carefully came
//    to be cut through the middle of a word. The phone sees the same rectangle,
//    only smaller.
//
// 2. THE FACE HANGS OVER THE BAND'S BOTTOM EDGE, which is what ties the two
//    halves of the hero together.
//
// 3. THE NAME IS BESIDE THE FACE at desktop widths, and the bio is the opening
//    line under both, in reading type rather than caption type.
//
// 4. THE STATS ARE A FULL-WIDTH BAND BELOW THE HERO. They used to wrap inside a
//    340px sticky column, which is what made six figures read as a receipt.

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const HANDLE = "testdrinker";
const PROFILE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GENERATIONS = [
  "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
];

/** The cropper's own ratio (`profileImageSlotSpec.cover.aspectRatio`). */
const COVER_ASPECT = 3;

/** A cover-shaped photo, so the band is measured holding a real one. */
function coverPng(): Promise<Buffer> {
  return sharp({
    create: { width: 1600, height: 533, channels: 3, background: { r: 32, g: 58, b: 84 } },
  })
    .png()
    .toBuffer();
}

/**
 * Give this profile a two-photo rotation. The band's aspect only has to match
 * the cropper's when it is HOLDING a photograph - with only the brass wash
 * there is nothing to crop - so the geometry is measured on a real one.
 */
async function installCoverRotation(page: Page): Promise<void> {
  const covers = GENERATIONS.map(
    (generation) => `/api/cover/${PROFILE_ID}/${generation}`,
  );
  // A URL predicate rather than a glob: the signed-out read carries no query
  // string at all, and `?` is a wildcard character in a Playwright glob.
  await page.route(
    (url) => url.pathname === `/api/profiles/${HANDLE}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: {
            id: PROFILE_ID,
            handle: HANDLE,
            displayName: "Test Drinker",
            bio: "Cheap pints, long walks home, and a soft spot for a back-room quiz.",
            coverUrl: covers[0],
            coverUrls: covers,
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          socialLinks: [],
          counts: { followers: 4, following: 6 },
          viewerFollowing: false,
          followsViewer: false,
        }),
      });
    },
  );
  const png = await coverPng();
  await page.route(
    (url) => url.pathname.startsWith(`/api/cover/${PROFILE_ID}/`),
    async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/png" },
        body: png,
      });
    },
  );
}

type HeroGeometry = {
  header: DOMRect;
  cover: DOMRect;
  avatar: DOMRect;
  names: DOMRect;
  stats: DOMRect;
  bio: { top: number; fontSize: number } | null;
  identityBottom: number;
  documentScrollsSideways: boolean;
};

async function heroGeometry(page: Page): Promise<HeroGeometry> {
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const { top, right, bottom, left, width, height } = node.getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    const bioNode = document.querySelector<HTMLElement>(".profileBio");
    return {
      header: rect("header.profileHeader"),
      cover: rect("header.profileHeader .profileCover"),
      avatar: rect("header.profileHeader .profileAvatar"),
      names: rect("header.profileHeader .profileNames"),
      stats: rect("header.profileHeader .profileStats"),
      identity: rect("header.profileHeader .profileIdentity"),
      bio: bioNode
        ? {
            top: bioNode.getBoundingClientRect().top,
            fontSize: Number.parseFloat(getComputedStyle(bioNode).fontSize),
          }
        : null,
      documentScrollsSideways:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });

  expect(geometry.header, "the profile header should render").not.toBeNull();
  expect(geometry.cover, "the cover band should render").not.toBeNull();
  expect(geometry.avatar, "the face should render").not.toBeNull();
  expect(geometry.names, "the names should render").not.toBeNull();
  expect(geometry.stats, "the stat band should render").not.toBeNull();
  expect(geometry.identity, "the identity row should render").not.toBeNull();

  return {
    header: geometry.header as unknown as DOMRect,
    cover: geometry.cover as unknown as DOMRect,
    avatar: geometry.avatar as unknown as DOMRect,
    names: geometry.names as unknown as DOMRect,
    stats: geometry.stats as unknown as DOMRect,
    bio: geometry.bio,
    identityBottom: (geometry.identity as unknown as DOMRect).bottom,
    documentScrollsSideways: geometry.documentScrollsSideways,
  };
}

async function openProfile(page: Page, withCover = true): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  if (withCover) await installCoverRotation(page);
  const response = await page.goto(`/u/${HANDLE}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("header.profileHeader")).toBeVisible();
  if (withCover) {
    await expect(page.locator("header.profileHeader.profileHeaderWithCover")).toBeVisible();
  }
}

test.describe("the desktop profile hero", () => {
  test.use({ viewport: DESKTOP });

  test("wears the cover as a full-width band at the cropper's own aspect", async ({ page }) => {
    await openProfile(page);
    const hero = await heroGeometry(page);

    // Full width of the card, not a column inside it.
    expect(Math.abs(hero.cover.width - hero.header.width)).toBeLessThanOrEqual(2);
    expect(hero.cover.width).toBeGreaterThan(900);

    // What was framed is what shows. One pixel of tolerance per side for the
    // browser's own sub-pixel rounding.
    const rendered = hero.cover.width / hero.cover.height;
    expect(Math.abs(rendered - COVER_ASPECT)).toBeLessThan(0.02);

    expect(hero.documentScrollsSideways).toBe(false);
  });

  test("hangs the face over the band's bottom edge, with the name beside it", async ({
    page,
  }) => {
    await openProfile(page);
    const hero = await heroGeometry(page);

    // Overlap: the band's edge falls INSIDE the circle.
    expect(hero.avatar.top).toBeLessThan(hero.cover.bottom);
    expect(hero.avatar.bottom).toBeGreaterThan(hero.cover.bottom);

    // Beside, not under.
    expect(hero.names.left).toBeGreaterThanOrEqual(hero.avatar.right);
    expect(hero.names.top).toBeGreaterThan(hero.cover.top);

    // Large enough to be the hero's face rather than a list thumbnail.
    expect(hero.avatar.width).toBeGreaterThanOrEqual(120);
  });

  test("prints the bio under the identity in reading type", async ({ page }) => {
    await openProfile(page);
    const hero = await heroGeometry(page);
    expect(hero.bio, "the stubbed profile carries a bio").not.toBeNull();

    // Identity above, bio under it as the opening line.
    expect(hero.bio!.top).toBeGreaterThanOrEqual(hero.identityBottom - 1);
    expect(hero.bio!.fontSize).toBeGreaterThanOrEqual(16);
  });

  // With only the brass wash there is no photograph to crop, so the band takes
  // a shorter height rather than four hundred pixels of gradient above the
  // fold. It is the same composition, just without a picture in it.
  test("keeps the brass wash short when no cover was approved", async ({ page }) => {
    await openProfile(page, false);
    const hero = await heroGeometry(page);

    expect(await page.locator(".profileCoverImage").count()).toBe(0);
    expect(hero.cover.height).toBeLessThan(220);
    expect(Math.abs(hero.cover.width - hero.header.width)).toBeLessThanOrEqual(2);
    expect(hero.avatar.top).toBeLessThan(hero.cover.bottom);
    expect(hero.avatar.bottom).toBeGreaterThan(hero.cover.bottom);
  });

  test("puts the stat band below the hero at the card's full width", async ({ page }) => {
    await openProfile(page);
    const hero = await heroGeometry(page);

    expect(hero.stats.top).toBeGreaterThanOrEqual(hero.identityBottom);
    expect(Math.abs(hero.stats.width - hero.header.width)).toBeLessThanOrEqual(2);
    // Nothing sits beside it: the squeeze was a 340px column, and this is the
    // whole card.
    expect(Math.abs(hero.stats.left - hero.header.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(hero.stats.right - hero.header.right)).toBeLessThanOrEqual(2);
  });
});

test.describe("the phone profile hero", () => {
  test.use({ viewport: PHONE });

  test("shows the same rectangle, only smaller, and never scrolls sideways", async ({
    page,
  }) => {
    await openProfile(page);
    const hero = await heroGeometry(page);

    const rendered = hero.cover.width / hero.cover.height;
    expect(Math.abs(rendered - COVER_ASPECT)).toBeLessThan(0.02);
    expect(hero.avatar.top).toBeLessThan(hero.cover.bottom);
    expect(hero.avatar.bottom).toBeGreaterThan(hero.cover.bottom);
    expect(hero.documentScrollsSideways).toBe(false);
  });
});
