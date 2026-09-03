import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROOF_PATH = "docs/proof/moment-photo-editor/moment-editor-390.png";
const PHOTO = readFileSync(resolve(process.cwd(), "docs/proof/night-mode-mid-crawl/after-390.png"));

async function momentPreviewDigest(page: Page): Promise<string> {
  return page.getByRole("img", { name: "Moment preview" }).evaluate(async (image) => {
    const response = await fetch((image as HTMLImageElement).src);
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

async function editorCanvasDigest(canvas: Locator): Promise<string> {
  return canvas.evaluate(async (element) => {
    const blob = await new Promise<Blob | null>((resolveBlob) => {
      (element as HTMLCanvasElement).toBlob(resolveBlob, "image/png");
    });
    if (!blob) throw new Error("Editor canvas could not be read.");
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

test.describe("Moment photo editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
  });

  test("edits with first-party crop, filter, text, and draw tools", async ({ page }) => {
    const editorProviderRequests: string[] = [];
    const externalWrites: string[] = [];
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      const appUrl = new URL(page.url());
      if (requestUrl.protocol === "blob:" || requestUrl.protocol === "data:") return;
      if (requestUrl.origin === appUrl.origin) return;
      if (requestUrl.hostname.includes("unlayer")) editorProviderRequests.push(request.url());
      if (!["GET", "HEAD"].includes(request.method())) {
        externalWrites.push(request.url());
      }
    });

    const momentUrl = process.env.PW_MOMENT_BASE_URL
      ? `${process.env.PW_MOMENT_BASE_URL}/moment`
      : "/moment";
    await page.goto(momentUrl);
    await page.locator('input[type="file"]').setInputFiles({
      name: "night.png",
      mimeType: "image/png",
      buffer: PHOTO,
    });
    await expect(page.getByRole("button", { name: "Edit night.png" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Edit photo" })).toHaveCount(0);
    const originalDigest = await momentPreviewDigest(page);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit photo" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use photo" })).toBeVisible();
    expect(editorProviderRequests).toEqual([]);
    expect(externalWrites).toEqual([]);

    await page.getByRole("button", { name: "Close editor" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("img", { name: "Moment preview" })).toBeVisible();

    await page.getByRole("button", { name: "Edit night.png" }).click();
    await expect(dialog).toBeVisible();
    const usePhoto = page.getByRole("button", { name: "Use photo" });
    await expect(usePhoto).toBeEnabled();
    await usePhoto.click();

    await expect(page.getByRole("group", { name: "Filter" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await momentPreviewDigest(page)).toBe(originalDigest);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.getByRole("group", { name: "Filter" })).toBeVisible();
    const canvas = page.getByRole("img", { name: "Edited photo preview" });
    await expect(canvas).toBeVisible();
    const originalCanvasDigest = await editorCanvasDigest(canvas);
    await page.getByRole("button", { name: "Warm" }).click();
    await expect(page.getByRole("button", { name: "Warm" })).toHaveAttribute("aria-pressed", "true");
    let filterCanvasDigest = originalCanvasDigest;
    await expect.poll(async () => {
      filterCanvasDigest = await editorCanvasDigest(canvas);
      return filterCanvasDigest;
    }).not.toBe(originalCanvasDigest);
    await page.getByRole("textbox", { name: "Text" }).fill("Friday detour");
    let textCanvasDigest = filterCanvasDigest;
    await expect.poll(async () => {
      textCanvasDigest = await editorCanvasDigest(canvas);
      return textCanvasDigest;
    }).not.toBe(filterCanvasDigest);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const start = { clientX: box.x + box.width * 0.25, clientY: box.y + box.height * 0.35 };
      const end = { clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.55 };
      await canvas.dispatchEvent("pointerdown", { ...start, pointerId: 7, pointerType: "touch", isPrimary: true });
      await canvas.dispatchEvent("pointermove", { ...end, pointerId: 7, pointerType: "touch", isPrimary: true });
      await canvas.dispatchEvent("pointerup", { ...end, pointerId: 7, pointerType: "touch", isPrimary: true });
    }
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeEnabled();
    await expect.poll(() => editorCanvasDigest(canvas)).not.toBe(textCanvasDigest);
    await page.screenshot({ path: PROOF_PATH, fullPage: false });
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Edited photo ready.")).toBeVisible();
    expect(await momentPreviewDigest(page)).not.toBe(originalDigest);
    expect(editorProviderRequests).toEqual([]);
    expect(externalWrites).toEqual([]);
  });
});
