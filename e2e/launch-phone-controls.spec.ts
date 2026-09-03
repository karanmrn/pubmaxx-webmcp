import { expect, test } from "@playwright/test";

// The V0.1 phone pass for the surfaces OUTSIDE the map shell. The map, the
// landing and the venue sheet already have their own rendered-geometry fences
// (e2e/mobile-map-chrome-fit.spec.ts, __tests__/mobileChromeFit.test.ts); these
// pages had none, and the first measured run found five control rows painting
// under the house 44px floor: Discover brand chips, Discover leaderboard pub
// names, Pubs jump chips, Find-your-lot invite links, and About press-kit links.
//
// THREE THINGS ARE MEASURED, all from the rendered page rather than from CSS,
// because these defects were invisible at desktop width and to any unit render:
//   - no horizontal overflow at 360, 390 and 430;
//   - every standalone control clears 44px tall and 24px wide;
//   - every visible zoom-triggering form control computes to at least 16px.
//
// The computed-size sweep complements __tests__/iosFormZoomFloor.test.ts. That
// static half guards the shared important floor and control selectors it can
// identify; this rendered half also catches class-only selectors, shorthands,
// nesting and inline styles after the browser resolves the cascade.
//
// WHAT COUNTS AS A STANDALONE CONTROL, and why the line is drawn there: a link
// flowing inside a sentence is exempt from the target-size rule by WCAG's own
// inline exception, and /about is largely prose. So the sweep takes buttons,
// inputs, textareas, selects, summaries, anything with an explicit button/tab
// role, and every anchor the page has laid out as its OWN box (a computed
// display that is not `inline`). That is the same distinction a thumb makes.
const WIDTHS = [360, 390, 430] as const;

const ROUTES = ["/about", "/discover", "/pubs", "/social", "/login", "/messages"] as const;
type LaunchRoute = (typeof ROUTES)[number];

const REQUIRED_TARGETS: Partial<Record<LaunchRoute, readonly string[]>> = {
  "/about": [".aboutLogoLinks .aboutLink"],
  "/discover": [".discoverBrandChip", "a.leaderboardPub"],
  "/pubs": [".pubsJumpChip"],
  "/social": [".findLot__ghost"],
  "/login": [".authSignIn.authMagicLinkButton"],
};

const REQUIRED_TEXT_FIELDS: Partial<Record<LaunchRoute, readonly string[]>> = {
  "/login": [".authMagicLinkInput"],
  "/social": [".findLot__field input"],
};

const ROUTE_ROOTS: Record<LaunchRoute, string> = {
  "/about": "main#main.aboutPage",
  "/discover": "main#main-content.socialPage .socialDiscoverBody",
  "/pubs": "main#main.pubsShell",
  "/social": "main#main-content.socialPage",
  "/login": "main.loginPage",
  "/messages": "main#main.messagesMainInbox",
};

const MIN_TAP_HEIGHT_PX = 44;
const MIN_TAP_WIDTH_PX = 24;

const REQUIRED_SELECTOR_TIMEOUT_MS = 45_000;
const SETTLE_CEILING_MS = 15_000;
const SETTLE_QUIET_MS = 600;

async function settle(
  page: import("@playwright/test").Page,
  route: LaunchRoute,
  width: (typeof WIDTHS)[number],
  requiredSelectors: readonly string[],
): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });

  if (requiredSelectors.length > 0) {
    await Promise.all(
      requiredSelectors.map((selector) =>
        expect(
          page.locator(selector).first(),
          `${route} @${width}: ${selector} never appeared`,
        ).toBeVisible({ timeout: REQUIRED_SELECTOR_TIMEOUT_MS }),
      ),
    );
    return;
  }

  // DOM quiet is only a fallback when a route has no required readiness target.
  // Unchanged loading markup for 600ms does not prove deferred content arrived.
  const deadline = Date.now() + SETTLE_CEILING_MS;
  let previous = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => document.querySelectorAll("*").length);
    if (count !== previous) {
      previous = count;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= SETTLE_QUIET_MS) {
      return;
    }
    await page.waitForTimeout(150);
  }
}

// A PHONE, not a narrow desktop window. The floors these pages state are
// scoped to `@media (pointer: coarse)` so desktop density is untouched, and a
// desktop context reports a fine pointer however narrow its viewport is, so a
// run without touch emulation would measure the desktop rules and report the
// fix as missing.
test.use({ hasTouch: true, isMobile: true });

test.describe("phone controls on the launch surfaces", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const route of ROUTES) {
    test(`${route} fits and stays tappable at 360/390/430`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        const response = await page.goto(route, { waitUntil: "load" });
        expect(response, `${route} @${width}: navigation must return a response`).not.toBeNull();
        if (!response) throw new Error(`${route} @${width}: navigation returned no response`);
        expect(
          response.ok(),
          `${route} @${width}: final response was ${response.status()} at ${response.url()}`,
        ).toBe(true);
        await expect(
          page.locator(`${ROUTE_ROOTS[route]}:visible`).first(),
          `${route} @${width}: expected route root ${ROUTE_ROOTS[route]}`,
        ).toBeVisible();
        const requiredSelectors = [
          ...(REQUIRED_TARGETS[route] ?? []),
          ...(REQUIRED_TEXT_FIELDS[route] ?? []),
        ];
        // Several of these pages reveal a section only once it is near the
        // viewport (Discover's leaderboard is the loudest), and how much of a
        // page that is depends on the width. This is how the first
        // run of this spec found the leaderboard link at 390 and not at 360.
        // Walk to the bottom, then wait for each named target before measuring.
        await settle(page, route, width, requiredSelectors);

        const report = await page.evaluate(
          ({ minHeight, minWidth, requiredSelectors }) => {
            const doc = document.documentElement;
            const overflowPx = Math.max(0, Math.round(doc.scrollWidth - doc.clientWidth));

            const isInvisible = (element: Element): boolean => {
              const style = getComputedStyle(element);
              return (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.visibility === "collapse" ||
                style.contentVisibility === "hidden" ||
                Number(style.opacity) === 0
              );
            };

            const union = (first: DOMRect, second: DOMRect): DOMRect => {
              const left = Math.min(first.left, second.left);
              const top = Math.min(first.top, second.top);
              const right = Math.max(first.right, second.right);
              const bottom = Math.max(first.bottom, second.bottom);
              return DOMRect.fromRect({
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
              });
            };

            const interactiveRect = (element: Element): DOMRect => {
              const rect = element.getBoundingClientRect();
              if (
                element instanceof HTMLInputElement &&
                (element.type === "checkbox" || element.type === "radio")
              ) {
                const label = element.labels?.[0];
                // Label is where thumb lands, so checkbox and radio hit area includes it.
                if (label && !isInvisible(label)) {
                  const labelRect = label.getBoundingClientRect();
                  if (labelRect.width > 0 && labelRect.height > 0) return union(rect, labelRect);
                }
              }
              return rect;
            };

            const required = requiredSelectors.map((requiredSelector) => ({
              selector: requiredSelector,
              sizes: Array.from(document.querySelectorAll(requiredSelector)).flatMap((element) => {
                if (isInvisible(element)) return [];
                const rect = interactiveRect(element);
                if (rect.width === 0 || rect.height === 0) return [];
                return [{ width: rect.width, height: rect.height }];
              }),
            }));

            const subFloorControls = Array.from(
              document.querySelectorAll("input, textarea, select"),
            ).flatMap((element) => {
              if (
                element instanceof HTMLInputElement &&
                ["hidden", "checkbox", "radio", "range"].includes(element.type)
              ) {
                return [];
              }
              if (isInvisible(element)) return [];
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return [];
              const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
              if (!Number.isFinite(fontSize) || fontSize >= 16) return [];
              const tag = element.tagName.toLowerCase();
              const firstClass = Array.from(element.classList)[0] ?? "(no-class)";
              return [`${tag}.${firstClass} ${Number(fontSize.toFixed(2))}px`];
            });

            const selector =
              'button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="tab"], a[href]';
            const small: string[] = [];
            for (const element of Array.from(document.querySelectorAll(selector))) {
              if (isInvisible(element)) continue;
              const style = getComputedStyle(element);
              // A link in a sentence is not a control (WCAG inline exception).
              if (element.tagName === "A" && style.display === "inline") continue;
              const rect = interactiveRect(element);
              if (rect.width === 0 || rect.height === 0) continue;
              if (rect.height >= minHeight && rect.width >= minWidth) continue;
              const name =
                (element.className || "").toString().split(" ").filter(Boolean)[0] ??
                element.tagName.toLowerCase();
              small.push(`${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            }
            return {
              overflowPx,
              required,
              small: [...new Set(small)],
              subFloorControls: [...new Set(subFloorControls)],
            };
          },
          {
            minHeight: MIN_TAP_HEIGHT_PX,
            minWidth: MIN_TAP_WIDTH_PX,
            requiredSelectors,
          },
        );

        for (const target of report.required) {
          expect(
            target.sizes.length,
            `${route} @${width}: ${target.selector} must render at least one visible element`,
          ).toBeGreaterThan(0);
          for (const size of target.sizes) {
            expect(
              size.height,
              `${route} @${width}: ${target.selector} is ${Math.round(size.width)}x${Math.round(size.height)}`,
            ).toBeGreaterThanOrEqual(MIN_TAP_HEIGHT_PX);
            expect(
              size.width,
              `${route} @${width}: ${target.selector} is ${Math.round(size.width)}x${Math.round(size.height)}`,
            ).toBeGreaterThanOrEqual(MIN_TAP_WIDTH_PX);
          }
        }

        expect(
          `${route} @${width}: overflow ${report.overflowPx}px`,
          "A phone page may never scroll sideways.",
        ).toBe(`${route} @${width}: overflow 0px`);

        expect(
          `${route} @${width}: ${report.small.join(", ") || "every control clears the floor"}`,
        ).toBe(`${route} @${width}: every control clears the floor`);

        expect(
          `${route} @${width}: ${
            report.subFloorControls.join(", ") || "every form control clears the 16px floor"
          }`,
        ).toBe(`${route} @${width}: every form control clears the 16px floor`);
      }
    });
  }
});
