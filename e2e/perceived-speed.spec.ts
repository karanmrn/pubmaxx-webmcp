import { test, expect, type Page } from "@playwright/test";

// Perceived-speed pair (IDEAS B4 + B5), verified WebGL-agnostically on a light,
// static public surface (/discover) so the map canvas is never involved.
//
//  - B5: the app-wide Speculation Rules <script type="speculationrules"> is
//    present with parseable JSON, uses conservative "moderate" eagerness, and
//    scopes candidates to the safe borough/discover/crawls surfaces while
//    EXCLUDING /map and side-effecting routes.
//  - B4: the root View-Transitions crossfade CSS is served (progressive
//    enhancement — the browser only uses it where the API exists / motion is
//    allowed, but the stylesheet must ship the rules regardless).
//
// Style matches the other new specs: watchPageErrors, web-first assertions,
// no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("perceived speed", () => {
  test("B5 — speculation rules script ships valid, conservatively-scoped JSON", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/discover");
    expect(response?.status()).toBe(200);

    // The inline JSON data block (not executable JS) is emitted in <head>.
    const script = page.locator('script[type="speculationrules"]');
    await expect(script).toHaveCount(1);

    const raw = await script.textContent();
    expect(raw, "speculationrules script has a body").toBeTruthy();

    // Must be valid JSON — parse it rather than string-matching.
    const rules = JSON.parse(raw as string) as {
      prerender?: Array<{
        source?: string;
        urls?: string[];
        where?: { href_matches?: string };
        eagerness?: string;
      }>;
    };

    expect(Array.isArray(rules.prerender)).toBe(true);
    const prerender = rules.prerender ?? [];
    expect(prerender.length).toBeGreaterThan(0);

    // Every rule is conservative: moderate eagerness (hover/pointerdown intent),
    // never "eager"/"immediate" which would over-prerender.
    for (const rule of prerender) {
      expect(rule.eagerness).toBe("moderate");
    }

    // Candidate surfaces are the safe explore-London loop only.
    const listUrls = prerender.flatMap((r) => r.urls ?? []);
    expect(listUrls).toContain("/crawls");
    expect(listUrls).toContain("/social?tab=discover");
    expect(listUrls).not.toContain("/feed");

    const matchers = prerender
      .map((r) => r.where?.href_matches)
      .filter((m): m is string => Boolean(m));
    expect(matchers).toContain("/borough/*");

    // Heavy / side-effecting routes are NEVER prerender candidates.
    const serialized = JSON.stringify(rules);
    expect(serialized).not.toContain("/map");
    expect(serialized).not.toContain("/api");

    expect(errors, "no page errors on /discover").toEqual([]);
  });

  test("B4 — root view-transition crossfade CSS is served", async ({ page }) => {
    await page.goto("/discover");

    // Progressive enhancement: the rules must be in the shipped CSS even though
    // only View-Transitions-capable browsers with motion allowed will use them.
    // Assert against the resolved stylesheet text (works regardless of whether
    // THIS browser paints the transition).
    const hasViewTransitionCss = await page.evaluate(() => {
      const wanted = "view-transition-new";
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          // Cross-origin sheet — skip.
          continue;
        }
        const stack: CSSRuleList[] = [rules];
        while (stack.length) {
          const list = stack.pop() as CSSRuleList;
          for (const rule of Array.from(list)) {
            if (rule.cssText.includes(wanted)) return true;
            // Descend into @media (prefers-reduced-motion) groups.
            const grouping = rule as CSSGroupingRule;
            if (grouping.cssRules) stack.push(grouping.cssRules);
          }
        }
      }
      return false;
    });

    expect(hasViewTransitionCss, "::view-transition-new rule present in CSS").toBe(true);
  });
});
