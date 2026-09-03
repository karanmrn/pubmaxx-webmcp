import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const VIEWPORT = { width: 390, height: 844 };
/** Pre-fix throttled cold-open baseline (Aug 2026 repro). */
const PAINT_REGRESSION_CEILING_MS = 20_000;
/** Lane gate per firstmate map-paint-sla decision (successor owns absolute 3s). */
const PAINT_SLA_MS = 16_000;
/** Achieved throttled production cold-open (Aug 2026 post-fix, best run). */
const PAINT_ACHIEVED_TILES_MS = 8_540;
const PAINT_ACHIEVED_PINS_MS = 14_000;

async function seedMap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
  });
}

/** True when neither half of the map is still on the pre-tile backbuffer. */
async function fullViewportBasemapPainted(page: Page): Promise<boolean> {
  const map = page.locator(".maplibreMap");
  if ((await map.count()) === 0) return false;
  const frame = await map.screenshot();
  const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const halfW = Math.floor(info.width / 2);
  const sampleH = Math.min(220, info.height);
  const top = Math.floor((info.height - sampleH) / 2);

  const paintedShare = (startX: number, width: number): number => {
    let nonBackbuffer = 0;
    let total = 0;
    for (let y = 0; y < sampleH; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = ((top + y) * info.width + (startX + x)) * 3;
        const r = data[index]!;
        const g = data[index + 1]!;
        const b = data[index + 2]!;
        total += 1;
        const nearBlack = r < 18 && g < 18 && b < 18;
        if (!nearBlack) nonBackbuffer += 1;
      }
    }
    return total === 0 ? 0 : nonBackbuffer / total;
  };

  const leftShare = paintedShare(0, halfW);
  const rightShare = paintedShare(halfW, info.width - halfW);
  return leftShare >= 0.2 && rightShare >= 0.2;
}

async function paintedPinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => Array<unknown>;
      }
    ).__pubmaxPaintedMapTapPoints;
    return probe?.().length ?? 0;
  });
}

test.use({
  viewport: VIEWPORT,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

test.describe("mobile map tile paint", () => {
  test("cold /map paints tiles and pins within the lane gate on a throttled profile", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 150,
    });

    await seedMap(page);
    const started = Date.now();
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    let tilePaintMs = 0;
    await expect
      .poll(
        async () => {
          if (await fullViewportBasemapPainted(page)) {
            tilePaintMs = Date.now() - started;
            return true;
          }
          return false;
        },
        {
          message: "the map canvas paints tiles across the full viewport",
          timeout: 60_000,
        },
      )
      .toBe(true);

    let pinPaintMs = 0;
    await expect
      .poll(
        async () => {
          const count = await paintedPinCount(page);
          if (count > 0) {
            pinPaintMs = Date.now() - started;
            return true;
          }
          return false;
        },
        {
          message: "at least one pub pin or cluster is painted on the map",
          timeout: 60_000,
        },
      )
      .toBe(true);

    test.info().annotations.push(
      { type: "tilePaintMs", description: `${tilePaintMs}` },
      { type: "pinPaintMs", description: `${pinPaintMs}` },
      { type: "paintAchievedTilesMs", description: `${PAINT_ACHIEVED_TILES_MS}` },
      { type: "paintAchievedPinsMs", description: `${PAINT_ACHIEVED_PINS_MS}` },
      { type: "paintSlaMs", description: `${PAINT_SLA_MS}` },
      { type: "paintRegressionCeilingMs", description: `${PAINT_REGRESSION_CEILING_MS}` },
    );
    console.log(
      `[mobile-map-tile-paint] tiles=${tilePaintMs}ms pins=${pinPaintMs}ms (sla=${PAINT_SLA_MS}ms regression<${PAINT_REGRESSION_CEILING_MS}ms)`,
    );
    expect(tilePaintMs).toBeLessThan(PAINT_REGRESSION_CEILING_MS);
    expect(pinPaintMs).toBeLessThan(PAINT_REGRESSION_CEILING_MS);
    expect(tilePaintMs).toBeLessThanOrEqual(PAINT_SLA_MS);
    expect(pinPaintMs).toBeLessThanOrEqual(PAINT_SLA_MS);
  });

  test("390px bottom map controls do not overlap and stay visible", async ({ page }) => {
    test.setTimeout(120_000);
    await seedMap(page);
    await page.addInitScript(() => {
      const now = "2026-01-01T00:00:00.000Z";
      window.localStorage.setItem(
        "pubmax_pub_pal_v1",
        JSON.stringify({
          id: "pal-e2e",
          ownerId: "owner-e2e",
          name: "Ada",
          adultAttestedAt: now,
          appearance: {},
          personality: {},
          voice: {},
          muted: false,
          hidden: false,
          proposalPreferences: {},
          masteryPoints: 0,
          createdAt: now,
          updatedAt: now,
        }),
      );
    });

    await page.goto("/map");
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Describe the outing" })).toBeVisible();
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(".palSummon")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".createFab")).toBeVisible();

    const boxes = await page.evaluate(() => {
      const read = (selector: string, name: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          name,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      };
      return [
        read(".mobilePlanActivation", "plan activation"),
        read(".palSummon", "Pub Pal pill"),
        read(".createFab", "create action"),
        read(".mobileMapLocateFab", "locate FAB"),
      ].filter(Boolean);
    });

    expect(boxes.map((box) => box!.name)).toEqual(
      expect.arrayContaining(["plan activation", "Pub Pal pill", "create action", "locate FAB"]),
    );

    for (const box of boxes) {
      expect(box!.width, `${box!.name} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${box!.name} height`).toBeGreaterThanOrEqual(44);
      expect(box!.left, `${box!.name} left`).toBeGreaterThanOrEqual(0);
      expect(box!.right, `${box!.name} right`).toBeLessThanOrEqual(VIEWPORT.width + 1);
    }

    const overlaps = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
      a!.left < b!.right &&
      b!.left < a!.right &&
      a!.top < b!.bottom &&
      b!.top < a!.bottom;

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(
          overlaps(boxes[i], boxes[j]),
          `${boxes[i]!.name} overlaps ${boxes[j]!.name}`,
        ).toBe(false);
      }
    }

    for (const box of boxes) {
      const centre = { x: box!.left + box!.width / 2, y: box!.top + box!.height / 2 };
      const owner = await page.evaluate((point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit) return "nothing";
        if (hit.closest(".mobilePlanActivation")) return "plan activation";
        if (hit.closest(".palSummon")) return "Pub Pal pill";
        if (hit.closest(".createFabRoot")) return "create action";
        if (hit.closest(".mobileMapLocateFab")) return "locate FAB";
        return hit.className || hit.tagName;
      }, centre);
      expect(owner, `${box!.name} owns its centre`).toBe(box!.name);
    }
  });
});
