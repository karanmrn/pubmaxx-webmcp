import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EmptyState from "@/components/EmptyState";

const emptyStateCss = readFileSync(join(process.cwd(), "components/emptyState.css"), "utf8");

// EmptyState is the shared "honest, beautiful empty state" contract (GH #18):
// short serif title, muted explainer, at most one action, role="status" by
// default. Rendered via react-dom/server (no jsdom needed) so this stays a
// plain node-environment unit test, matching the rest of this suite.
describe("EmptyState", () => {
  it("renders the title and defaults to role=status (a passive result, not an error)", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: "Nothing here yet." }));
    expect(html).toContain("Nothing here yet.");
    expect(html).toContain('role="status"');
    // Decorative stamp is always present; content wrappers stay optional.
    expect(html).toContain('class="emptyStateStamp"');
    expect(html).toContain('aria-hidden="true"');
    // No eyebrow/body/action passed → none of those wrapper elements render.
    expect(html).not.toContain("emptyStateEyebrow");
    expect(html).not.toContain("emptyStateBody");
    expect(html).not.toContain("emptyStateAction");
  });

  it("renders the eyebrow, body, and action when provided", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        eyebrow: "Quiet at the bar",
        title: "No pints logged yet tonight.",
        body: "Be the first to drop one.",
        action: createElement("a", { href: "/map" }, "Find a pub"),
      }),
    );
    expect(html).toContain("Quiet at the bar");
    expect(html).toContain("No pints logged yet tonight.");
    expect(html).toContain("Be the first to drop one.");
    expect(html).toContain("Find a pub");
    expect(html).toContain('href="/map"');
  });

  it("supports role=alert for a failed (not merely empty) result", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "Couldn't load pints.", role: "alert" }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("appends a page-specific className to the root without dropping the base class", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "No saved pubs yet.", className: "feedEmpty" }),
    );
    expect(html).toContain('class="emptyState feedEmpty"');
  });

  it("uses pressed paper / ink-stamp material, not a dashed upload zone", () => {
    // Solid hairline + inset press, never the dashed placeholder idiom.
    expect(emptyStateCss).not.toMatch(/border:\s*1px dashed/);
    expect(emptyStateCss).toMatch(/border:\s*1px solid/);
    expect(emptyStateCss).toMatch(/box-shadow:\s*var\(--shadow-inset-press\)/);
    expect(emptyStateCss).toMatch(/\.emptyStateStamp\s*{/);
    expect(emptyStateCss).toMatch(/border:\s*var\(--ink-stamp-border\)/);
    // Stamp motion is opt-in; reduce kills it.
    expect(emptyStateCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*{[\s\S]*?\.emptyStateStamp/,
    );
    expect(emptyStateCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[\s\S]*?\.emptyStateStamp\s*{[\s\S]*?animation:\s*none/,
    );
    // Flat seal only — press-tilt stays the price signature.
    expect(emptyStateCss).not.toMatch(/ink-stamp--tilt|--ink-stamp-tilt/);
  });
});
