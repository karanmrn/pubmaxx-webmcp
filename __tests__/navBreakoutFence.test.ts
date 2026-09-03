import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/* WHY THIS FENCE EXISTS (regression review D6)
 *
 * On mobile (max-width: 640px) the in-flow standard top bar escapes its host
 * column with a single geometric breakout:
 *
 *   .siteNavBar:not(.siteNavBarFloating) {
 *     margin-inline: calc(var(--topbar-side, 10px) - (100vw - 100%) / 2);
 *   }
 *
 * The term (100vw - 100%) / 2 measures the gap between the viewport edge and
 * the bar's containing block. That measurement is ONLY correct when the host
 * centres its content symmetrically: equal left and right gutters, whatever
 * their size (0, 16px, or --page-gutter, the formula nets them all out).
 *
 * The assumption is invisible at the call site. One logical change breaks it:
 * a host shell gains asymmetric padding (padding-left != padding-right), an
 * asymmetric margin, a sidebar column at mobile widths, or a max-width cap
 * without auto centring (which pins the column to the left edge). Any of
 * those makes (100vw - 100%) / 2 measure the AVERAGE gap, not the actual
 * left/right gaps, and the bar silently misaligns on every page served by
 * that shell - typically dragging the wordmark off one viewport edge (the
 * audit F2 clipped-"UBMAXX" failure mode).
 *
 * This fence pins both halves of the contract:
 *   1. The formula in siteNav.css stays in its exact symmetric form.
 *   2. Every shell that hosts the in-flow bar stays a symmetric container in
 *      the viewport range where the breakout is active (<= 640px).
 *
 * If a future layout genuinely needs an asymmetric host (sidebar, uneven
 * gutters), do NOT weaken this test to let it through. Fix the mechanism
 * instead: either give the bar an explicit per-side gutter variable set by
 * each shell (e.g. --nav-gutter-left / --nav-gutter-right subtracted per
 * side), or move the bar out of the padded column entirely so it lays out
 * against the viewport, or switch the measurement to container queries once
 * the bar can read its host's inline size directly. Then update this fence
 * to encode the new contract.
 */

const read = (relPath: string): string =>
  readFileSync(join(process.cwd(), relPath), "utf8");

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface CssRule {
  selector: string;
  body: string;
  /** Enclosing at-rule preludes, outermost first (e.g. "@media (max-width: 640px)"). */
  atRules: string[];
}

/**
 * Minimal flat-CSS rule scanner (no nested style rules, which this codebase
 * does not use). Tracks at-rule context so callers can scope checks to the
 * viewport range where the breakout formula is active.
 */
function parseRules(css: string): CssRule[] {
  const src = stripComments(css);
  const rules: CssRule[] = [];
  const atStack: string[] = [];
  let buf = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = buf.trim();
      buf = "";
      if (prelude.startsWith("@")) {
        atStack.push(prelude);
      } else {
        const close = src.indexOf("}", i);
        const end = close === -1 ? src.length : close;
        rules.push({ selector: prelude, body: src.slice(i + 1, end), atRules: [...atStack] });
        i = end; // the trailing "}" belongs to this style rule, not the stack
      }
    } else if (ch === "}") {
      atStack.pop();
      buf = "";
    } else if (ch === ";") {
      // Top-level semicolon: a statement at-rule (@import, @charset). Discard.
      buf = "";
    } else {
      buf += ch;
    }
    i += 1;
  }
  return rules;
}

/** True when a selector list contains a part whose subject is the given class. */
function targetsClass(selector: string, className: string): boolean {
  const subject = new RegExp(
    `(^|[\\s>+~])\\.${className}(?:[.:#[][^\\s]*)?$`,
  );
  return selector.split(",").some((part) => subject.test(part.trim()));
}

/**
 * The breakout only applies inside @media (max-width: 640px). A host rule
 * scoped to strictly wider viewports (min-width > 640px) can never coincide
 * with the formula, so it is exempt from the symmetry fence (e.g. the
 * tonight desktop grid).
 */
function appliesAtMobileWidths(rule: CssRule): boolean {
  return rule.atRules.every((at) => {
    const min = at.match(/min-width:\s*(\d+(?:\.\d+)?)px/);
    return min === null || Number(min[1]) <= 640;
  });
}

/** Split a declaration value on top-level whitespace (parens-aware). */
function splitValue(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur !== "") parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

function declarationsOf(body: string): Array<{ prop: string; value: string }> {
  return body
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => decl.includes(":"))
    .map((decl) => {
      const idx = decl.indexOf(":");
      return { prop: decl.slice(0, idx).trim(), value: decl.slice(idx + 1).trim() };
    });
}

const siteNavCss = read("components/nav/siteNav.css");
const globalsCss = read("app/globals.css");

/* Every shell that renders the in-flow (non-floating) SiteNav as a direct
 * child. Sourced from the breakout comment in siteNav.css plus the routes'
 * own markup. "margin-auto" hosts centre a capped column, "flex-center"
 * hosts centre flex children (the bar opts out via align-self: stretch),
 * "full-bleed" hosts are unpadded full-width blocks. All three shapes are
 * symmetric, which is exactly what the formula requires. */
const HOSTS: Array<{
  route: string;
  file: string;
  className: string;
  centering: "margin-auto" | "flex-center" | "full-bleed";
}> = [
  { route: "/feed", file: "app/feed/feed.css", className: "feedShell", centering: "flex-center" },
  { route: "/tonight", file: "app/tonight/tonight.css", className: "tonightPage", centering: "margin-auto" },
  { route: "/activity", file: "app/activity/activity.css", className: "activityShell", centering: "margin-auto" },
  { route: "/messages", file: "app/messages/messages.css", className: "messagesPage", centering: "full-bleed" },
  { route: "/moment", file: "components/moment/moment.css", className: "momentPage", centering: "full-bleed" },
  { route: "/u/[handle]", file: "app/u/[handle]/profile.css", className: "profilePage", centering: "full-bleed" },
];

describe("nav breakout fence (D6): the formula", () => {
  it("keeps the breakout in its exact symmetric form", () => {
    // width: auto lets the symmetric negative margins widen the bar, and
    // align-self: stretch defeats flex-centred hosts shrink-wrapping it.
    // All three declarations are one mechanism; assert them as a block.
    expect(siteNavCss).toMatch(
      /\.siteNavBar:not\(\.siteNavBarFloating\)\s*\{\s*width:\s*auto;\s*align-self:\s*stretch;\s*margin-inline:\s*calc\(var\(--topbar-side,\s*10px\)\s*-\s*\(100vw\s*-\s*100%\)\s*\/\s*2\);\s*\}/,
    );
  });

  it("uses the geometric gap term exactly once (no competing breakout)", () => {
    const occurrences = stripComments(siteNavCss).match(/100vw\s*-\s*100%/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("keeps the --topbar-side token equal to the formula's fallback", () => {
    const token = stripComments(siteNavCss).match(/--topbar-side:\s*([^;]+);/);
    const fallback = stripComments(siteNavCss).match(
      /var\(--topbar-side,\s*([^)]+)\)\s*-\s*\(100vw/,
    );
    expect(token?.[1].trim()).toBe("10px");
    expect(fallback?.[1].trim()).toBe("10px");
  });

  it("never skews the in-flow bar with left/right margin longhands", () => {
    const barRules = parseRules(siteNavCss).filter((rule) =>
      targetsClass(rule.selector, "siteNavBar"),
    );
    expect(barRules.length).toBeGreaterThan(0);
    for (const rule of barRules) {
      for (const { prop } of declarationsOf(rule.body)) {
        expect(prop, `${rule.selector} declares ${prop}`).not.toMatch(
          /^(margin-left|margin-right)$/,
        );
      }
    }
  });
});

describe("nav breakout fence (D6): host shells stay symmetric", () => {
  it("keeps --page-gutter a single symmetric token covering both safe-area insets", () => {
    // The gutter is applied to both sides at once; its definition takes the
    // max of the left AND right insets rather than padding each side by its
    // own inset, which is what keeps notched-landscape gutters symmetric.
    const def = stripComments(globalsCss).match(/--page-gutter:\s*([^;]+);/);
    expect(def).not.toBeNull();
    expect(def?.[1]).toContain("safe-area-inset-left");
    expect(def?.[1]).toContain("safe-area-inset-right");
  });

  for (const host of HOSTS) {
    describe(`${host.route} (.${host.className})`, () => {
      const css = read(host.file);
      const hostRules = parseRules(css).filter(
        (rule) => targetsClass(rule.selector, host.className) && appliesAtMobileWidths(rule),
      );

      it("still exists as a styled shell", () => {
        expect(hostRules.length).toBeGreaterThan(0);
      });

      it("declares no per-side inline padding or margin longhands", () => {
        for (const rule of hostRules) {
          for (const { prop } of declarationsOf(rule.body)) {
            expect(prop, `${host.file}: ${rule.selector} declares ${prop}`).not.toMatch(
              /^(padding-left|padding-right|margin-left|margin-right)$/,
            );
          }
        }
      });

      it("keeps shorthand padding/margin symmetric (4-value right must equal left)", () => {
        for (const rule of hostRules) {
          for (const { prop, value } of declarationsOf(rule.body)) {
            if (prop !== "padding" && prop !== "margin") continue;
            const parts = splitValue(value);
            if (parts.length === 4) {
              expect(parts[1], `${host.file}: ${rule.selector} { ${prop}: ${value} }`).toBe(
                parts[3],
              );
            }
          }
        }
      });

      it("keeps -inline shorthands single-valued or equal-per-side", () => {
        for (const rule of hostRules) {
          for (const { prop, value } of declarationsOf(rule.body)) {
            if (prop !== "padding-inline" && prop !== "margin-inline") continue;
            const parts = splitValue(value);
            if (parts.length === 2) {
              expect(parts[0], `${host.file}: ${rule.selector} { ${prop}: ${value} }`).toBe(
                parts[1],
              );
            } else {
              expect(parts, `${host.file}: ${rule.selector} { ${prop}: ${value} }`).toHaveLength(1);
            }
          }
        }
      });

      it("never caps its width without auto centring (a left-pinned column is asymmetric)", () => {
        const decls = hostRules.flatMap((rule) => declarationsOf(rule.body));
        const hasMaxWidth = decls.some((d) => d.prop === "max-width");
        if (!hasMaxWidth) return;
        const centred = decls.some(
          (d) =>
            (d.prop === "margin" && /^0\s+auto\b/.test(d.value)) ||
            (d.prop === "margin-inline" && d.value === "auto"),
        );
        expect(centred, `${host.file}: .${host.className} caps max-width without margin auto`).toBe(
          true,
        );
      });

      it("keeps its documented centering mechanism", () => {
        const decls = hostRules.flatMap((rule) => declarationsOf(rule.body));
        if (host.centering === "margin-auto") {
          const centred = decls.some(
            (d) =>
              (d.prop === "margin" && /^0\s+auto\b/.test(d.value)) ||
              (d.prop === "margin-inline" && d.value === "auto"),
          );
          expect(centred, `${host.file}: .${host.className} lost margin auto centring`).toBe(true);
        } else if (host.centering === "flex-center") {
          const isFlex = decls.some((d) => d.prop === "display" && /flex/.test(d.value));
          const centersItems = decls.some(
            (d) => d.prop === "align-items" && d.value === "center",
          );
          expect(isFlex, `${host.file}: .${host.className} is no longer a flex column`).toBe(true);
          expect(
            centersItems,
            `${host.file}: .${host.className} no longer centres flex children`,
          ).toBe(true);
        }
        // full-bleed hosts need no explicit mechanism: an unpadded block is
        // symmetric by construction, and the max-width check above guards
        // the one way they could silently stop being full-bleed.
      });
    });
  }
});
