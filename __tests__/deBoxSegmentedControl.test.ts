import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The de-box rule (design judgement 2026-08-01, finding 2.5): borders are for
 * inputs, fills are for selection, hairlines are for structure.
 *
 * The map-controls row drew the four UNSELECTED segments as filled, bordered
 * boxes and the selected one as a dark slab, so the eye read the wrong tabs as
 * active. The cause was an omission, not a colour: this app ships no Tailwind
 * preflight, so a `<button>` with no explicit border/background inherits the
 * user agent's `2px outset buttonborder` on `buttonface`. These tests hold the
 * selected state to being the FILLED one and hold every segment to carrying no
 * border of its own.
 */
function renderControl(selected: string): string {
  return renderToStaticMarkup(
    createElement(
      Tabs,
      { value: selected, onValueChange: () => undefined },
      createElement(
        TabsList,
        { "aria-label": "Map control sections" },
        createElement(TabsTrigger, { value: "key" }, "Key"),
        createElement(TabsTrigger, { value: "layers" }, "Layers"),
        createElement(TabsTrigger, { value: "prices" }, "Prices"),
        createElement(TabsTrigger, { value: "events" }, "Events"),
        createElement(TabsTrigger, { value: "transit" }, "Transit"),
      ),
    ),
  );
}

/** Every `class="..."` on a `role="tab"` element, in document order. */
function tabClassNames(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => {
    const cls = /class="([^"]*)"/.exec(match[0]);
    return cls ? cls[1] : "";
  });
}

function selectedIndex(markup: string): number {
  return [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].findIndex((m) =>
    m[0].includes('aria-selected="true"'),
  );
}

describe("segmented map controls: selection is the fill", () => {
  it("gives the SELECTED segment the raised fill and leaves the others unfilled", () => {
    const markup = renderControl("prices");
    const classes = tabClassNames(markup);
    const active = selectedIndex(markup);

    expect(classes).toHaveLength(5);
    expect(active).toBe(2);

    // The one filled segment is the selected one.
    const filled = classes.filter((c) => c.includes("bg-[var(--color-surface-raised)]"));
    expect(filled).toHaveLength(1);
    expect(classes[active]).toContain("bg-[var(--color-surface-raised)]");

    // Unselected segments carry no fill at all.
    classes.forEach((cls, index) => {
      if (index === active) return;
      expect(cls).toContain("bg-transparent");
      expect(cls).not.toContain("bg-[var(--color-surface-raised)]");
    });
  });

  it("reads the selected segment louder than the unselected ones", () => {
    const markup = renderControl("key");
    const classes = tabClassNames(markup);
    const active = selectedIndex(markup);

    expect(classes[active]).toContain("text-[var(--color-text)]");
    classes.forEach((cls, index) => {
      if (index === active) return;
      expect(cls).toContain("text-[var(--color-text-muted)]");
      expect(cls).not.toContain("text-[var(--color-text)]");
    });
  });

  it("gives no segment a border of its own, selected or not", () => {
    const markup = renderControl("layers");
    for (const cls of tabClassNames(markup)) {
      expect(cls).toContain("border-0");
      expect(cls).not.toMatch(/(?:^|\s)border-\[/);
    }
  });

  it("puts at most one hairline around the whole group", () => {
    const markup = renderControl("layers");
    const list = /<div[^>]*role="tablist"[^>]*>/.exec(markup);
    expect(list).not.toBeNull();
    expect(list?.[0]).toContain("border-[var(--color-border-soft)]");
    expect(list?.[0]).toContain("bg-transparent");
  });
});
