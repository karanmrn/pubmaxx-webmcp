import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// The photo picker and the crop step, on a phone-sized viewport.
//
// What this CAN prove: the picker input's own attributes, that a chosen photo
// opens a crop step rather than uploading, that the crop reaches the existing
// route as a JPEG cut to the slot's box, and that a file the browser cannot
// decode is refused with a sentence a person can act on.
//
// What no browser test can prove: that iOS now offers the photo library. The
// sheet `capture` suppressed belongs to the operating system, and Playwright
// never opens it. That half is fenced on the source in
// __tests__/profilePhotoPicker.test.ts.

const VIEWPORT = { width: 390, height: 844 };
const SHOT_DIR = "/tmp/pubmax-photo-crop";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000a";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "cropproof";
const PROFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/**
 * A landscape photo with an off-centre mark, so a crop has something to cut
 * into and a drag visibly changes what survives.
 */
function widePng(): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 196, g: 122, b: 46 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="900" height="600">' +
            '<rect x="0" y="0" width="240" height="600" fill="#16283a"/>' +
            '<circle cx="700" cy="180" r="110" fill="#f4efe6"/>' +
            "</svg>",
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function installOwnedProfileBoundary(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: "pubmaxx-e2e-access-token",
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "crop-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-08-01T00:00:00.000Z",
        },
      }),
    );
  }, { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID });

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "crop-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: HANDLE, dateOfBirth: "1994-03-02" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: HANDLE }),
    });
  });
}

type UploadRecord = { calls: number; bodies: Buffer[] };

/**
 * Answer the slot's upload route in the browser and keep whatever it received.
 *
 * The wire body is the stronger proof, but WebKit does not hand Playwright the
 * post data of a multipart request, so `bodies` is empty there while `calls`
 * still counts. What both engines can measure is the File the composer handed
 * `fetch`, which is the crop's own output, so that is what the size assertions
 * read and the wire body is checked as well wherever it exists.
 */
async function captureUpload(page: Page, slot: "avatar" | "cover"): Promise<UploadRecord> {
  const record: UploadRecord = { calls: 0, bodies: [] };
  const url = `/api/cover/${PROFILE_ID}/${GENERATION}`;
  // The backdrop is a rotation now, so a cover POSTs to `/covers` and the reply
  // carries the whole list beside the whole profile.
  const path = slot === "avatar" ? `${HANDLE}/avatar` : `${HANDLE}/covers`;
  const profile = {
    id: PROFILE_ID,
    handle: HANDLE,
    displayName: "Crop proof",
    ...(slot === "avatar"
      ? { avatarUrl: `/api/avatar/${PROFILE_ID}/${GENERATION}` }
      : { coverUrl: url, coverUrls: [url] }),
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };

  await page.route(`**/api/profiles/${path}`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      // The covers editor reads its own list on mount.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", covers: [] }),
      });
      return;
    }
    if (method !== "POST") {
      await route.continue();
      return;
    }
    record.calls += 1;
    const body = route.request().postDataBuffer();
    if (body) record.bodies.push(body);
    await route.fulfill({
      status: slot === "avatar" ? 200 : 201,
      contentType: "application/json",
      body: JSON.stringify({
        profile,
        ...(slot === "cover"
          ? { covers: [{ id: "cover-1", position: 1, url }], status: "ready" }
          : {}),
      }),
    });
  });

  const png = await widePng();
  await page.route(`**/api/${slot}/${PROFILE_ID}/${GENERATION}`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: png,
    });
  });
  return record;
}

type CropOutput = { name: string; type: string; width: number; height: number };

/** Watch the photo the composer hands `fetch`, and measure it in the page. */
async function watchCropOutput(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      if (body instanceof FormData) {
        const photo = body.get("photo");
        if (photo instanceof File) {
          const bitmap = await createImageBitmap(photo);
          (window as unknown as { __cropOutput?: unknown }).__cropOutput = {
            name: photo.name,
            type: photo.type,
            width: bitmap.width,
            height: bitmap.height,
          };
          bitmap.close();
        }
      }
      return original(input, init);
    };
  });
}

async function measureCropOutput(page: Page): Promise<CropOutput | null> {
  return page.evaluate(
    () => (window as unknown as { __cropOutput?: CropOutput | null }).__cropOutput ?? null,
  );
}

/**
 * The same measurement taken off the wire, wherever the engine exposes it.
 * Chromium hands Playwright the raw multipart bytes; WebKit hands back a
 * decoded string the JPEG cannot be recovered from, so this returns null there
 * and the in-page measurement above stays the assertion both engines make.
 */
async function measureUploadedBody(record: UploadRecord) {
  expect(record.calls).toBe(1);
  const body = record.bodies[0];
  if (!body) return null;
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const end = body.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (start < 0 || end <= start) return null;
  const metadata = await sharp(body.subarray(start, end + 2)).metadata();
  return { format: metadata.format, width: metadata.width, height: metadata.height };
}

/** The crop step on its own, and the phone screen it sits on. */
async function shoot(page: Page, name: string): Promise<void> {
  const step = page.locator(".profileCropStep");
  await expect(step).toBeVisible();
  await step.scrollIntoViewIfNeeded();
  await step.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
  await page.screenshot({ path: join(SHOT_DIR, `${name}-screen.png`) });
}

async function openOwnProfileEditor(page: Page): Promise<void> {
  const response = await page.goto(`/u/${HANDLE}`);
  expect(response?.status()).toBe(200);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
}

async function pick(page: Page, slot: "avatar" | "cover", name: string): Promise<void> {
  await page.locator(`#pe-${slot}-file`).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: await widePng(),
  });
}

test.describe("profile photo picker and crop", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await watchCropOutput(page);
    await installOwnedProfileBoundary(page);
  });

  test("both pickers ask for photos and neither asks for a camera", async ({ page }) => {
    await openOwnProfileEditor(page);

    for (const id of ["#pe-avatar-file", "#pe-cover-file"]) {
      const input = page.locator(id);
      await expect(input).toHaveAttribute("type", "file");
      // `capture` is what removed Photo Library from the iOS sheet.
      expect(await input.getAttribute("capture")).toBeNull();
      const accept = (await input.getAttribute("accept")) ?? "";
      expect(accept).toContain("image/heic");
      expect(accept).toContain("image/jpeg");
      expect(accept).not.toContain("*");
    }
  });

  test("a chosen photo opens the crop step before anything uploads", async ({ page }) => {
    const record = await captureUpload(page, "avatar");

    await openOwnProfileEditor(page);
    await pick(page, "avatar", "IMG_2201.png");

    await expect(page.locator(".profileCropStep-avatar .profileCropFrame")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use photo" })).toBeEnabled();
    expect(record.calls).toBe(0);

    await shoot(page, "crop-avatar-390");

    // Cancel puts the slot back the way it was, with nothing sent.
    await page.locator(".profileCropCancel").click();
    await expect(page.locator(".profileCropStep")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose photo" })).toBeVisible();
    expect(record.calls).toBe(0);
    expect(await measureCropOutput(page)).toBeNull();
  });

  test("the avatar crop uploads a square JPEG at the slot's own size", async ({ page }) => {
    const record = await captureUpload(page, "avatar");
    await openOwnProfileEditor(page);
    await pick(page, "avatar", "IMG_2202.png");

    const zoom = page.locator("#pe-avatar-zoom");
    await expect(zoom).toBeEnabled();
    await zoom.fill("40");
    await shoot(page, "crop-avatar-zoomed-390");

    await page.getByRole("button", { name: "Use photo" }).click();
    // The reply repaints the card and the editor STAYS OPEN, so the signal the
    // POST finished is the preview taking the returned URL. Waiting on the crop
    // step, or on the picker coming back, races it: both change the moment the
    // crop is handed over, before the request has been answered.
    await expect(page.locator("img.profileEditorAvatarPreview")).toHaveAttribute(
      "src",
      new RegExp(`^/api/avatar/${PROFILE_ID}/${GENERATION}(?:\\?.*)?$`),
    );
    await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();

    expect(await measureCropOutput(page)).toEqual({
      name: "avatar.jpg",
      type: "image/jpeg",
      width: 512,
      height: 512,
    });
    const onTheWire = await measureUploadedBody(record);
    if (onTheWire) {
      expect(onTheWire).toEqual({ format: "jpeg", width: 512, height: 512 });
    }
  });

  test("the cover crop uploads a wide JPEG at the slot's own size", async ({ page }) => {
    const record = await captureUpload(page, "cover");
    await openOwnProfileEditor(page);
    await pick(page, "cover", "IMG_2203.png");

    await expect(page.locator(".profileCropStep-cover .profileCropFrame")).toBeVisible();
    await shoot(page, "crop-cover-390");

    // Drag the photo across the wide frame, then take what is under it.
    const frame = page.locator(".profileCropStep-cover .profileCropFrame");
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await page.getByRole("button", { name: "Use photo" }).click();
    // The fresh cover appears as a numbered thumbnail in the rotation, with the
    // editor still open around it. The thumbnail is the completion signal: the
    // picker and the crop step both change before the request is answered.
    await expect(page.getByRole("img", { name: "Cover 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();

    expect(await measureCropOutput(page)).toEqual({
      name: "cover.jpg",
      type: "image/jpeg",
      width: 1600,
      height: 533,
    });
    const onTheWire = await measureUploadedBody(record);
    if (onTheWire) {
      expect(onTheWire).toEqual({ format: "jpeg", width: 1600, height: 533 });
    }
  });

  test("add then remove cover restores the empty default", async ({ page }) => {
    const url = `/api/cover/${PROFILE_ID}/${GENERATION}`;
    let covers: Array<{ id: string; position: number; url: string }> = [];

    page.on("dialog", (dialog) => void dialog.accept());

    await page.route(`**/api/profiles/${HANDLE}/covers**`, async (route) => {
      const requestUrl = route.request().url();
      const method = route.request().method();

      if (method === "GET" && requestUrl.endsWith(`/covers`)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ready", covers }),
        });
        return;
      }

      if (method === "POST") {
        covers = [{ id: "cover-1", position: 1, url }];
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ready",
            covers,
            profile: {
              id: PROFILE_ID,
              handle: HANDLE,
              displayName: "Crop proof",
              coverUrl: url,
              coverUrls: [url],
            },
          }),
        });
        return;
      }

      if (method === "DELETE" && requestUrl.includes("/covers/cover-1")) {
        covers = [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ready",
            covers: [],
            profile: {
              id: PROFILE_ID,
              handle: HANDLE,
              displayName: "Crop proof",
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.route(`**/api/cover/${PROFILE_ID}/${GENERATION}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/png" },
        body: await widePng(),
      });
    });

    await openOwnProfileEditor(page);
    await pick(page, "cover", "IMG_2207.png");
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.getByRole("img", { name: "Cover 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove cover" })).toBeVisible();

    await page.getByRole("button", { name: "Remove cover" }).click();
    await expect(page.getByRole("img", { name: "Cover 1" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove cover" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add cover" })).toBeVisible();
  });

  // THE DEFECT: choosing a photo from the editor threw the owner out to the
  // read-only profile, because an image write reported through the same
  // callback the Save button used. Somebody there to change five things had to
  // re-open the editor after the first one.
  test("an upload keeps the editor open with the fresh image in place", async ({ page }) => {
    const record = await captureUpload(page, "avatar");
    await openOwnProfileEditor(page);
    await pick(page, "avatar", "IMG_2205.png");
    await page.getByRole("button", { name: "Use photo" }).click();

    await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
    // The editor's own preview and the card's face both carry the new photo.
    await expect(page.locator("img.profileEditorAvatarPreview")).toHaveAttribute(
      "src",
      new RegExp(`^/api/avatar/${PROFILE_ID}/${GENERATION}(?:\\?.*)?$`),
    );
    await expect(page.locator("header.profileHeader img.profileAvatar")).toBeVisible();
    // The read-only confirmation belongs to the end of a session, and this is
    // not the end of one.
    await expect(page.locator(".profileSavedNotice")).toHaveCount(0);
    expect(record.calls).toBe(1);

    // A second photo goes up from the same open editor, which is what "five
    // things" means.
    await pick(page, "avatar", "IMG_2206.png");
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
    expect(record.calls).toBe(2);
  });

  test("a photo this browser cannot open says where to go instead", async ({ page }) => {
    const record = await captureUpload(page, "avatar");
    await openOwnProfileEditor(page);

    // Chromium decodes no HEIC, which is exactly the case the copy is for. On a
    // browser that DOES decode it (Safari), the crop re-encodes it to JPEG and
    // the upload succeeds, which the two crop tests above already cover.
    await page.locator("#pe-avatar-file").setInputFiles({
      name: "IMG_2204.HEIC",
      mimeType: "image/heic",
      buffer: Buffer.from("AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZg==", "base64"),
    });

    const status = page.locator(".profileCropStep [role='status']");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Open it in Photos, share it as a JPEG/i);
    // Nothing to position, so no frame, no zoom and no confirm: the sentence
    // and the way back are the whole surface.
    await expect(page.locator(".profileCropFrame")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use photo" })).toHaveCount(0);
    await expect(page.locator(".profileCropCancel")).toBeVisible();
    expect(record.calls).toBe(0);

    await shoot(page, "crop-heic-refused-390");
  });
});
