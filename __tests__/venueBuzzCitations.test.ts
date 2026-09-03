import { isValidElement, type ReactElement } from "react";
import { describe, it, expect } from "vitest";

import { renderBuzzSummary } from "@/components/map/VenueBuzz";

type Mention = { label: string; url: string };

const mentions: Mention[] = [
  { label: "The Infatuation", url: "https://theinfatuation.com/london/x" },
  { label: "Time Out", url: "https://timeout.com/london/y" },
  { label: "Insecure", url: "http://example.com/z" }, // non-https on purpose
];

function elements(nodes: ReturnType<typeof renderBuzzSummary>): ReactElement[] {
  return nodes.filter((n): n is ReactElement => isValidElement(n));
}

function childrenOf(el: ReactElement): unknown {
  return (el.props as { children?: unknown }).children;
}

// Pull the visible text out of the mixed (string | element) node array so a
// test can assert the reading experience without a DOM.
function textOf(nodes: ReturnType<typeof renderBuzzSummary>): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") out += node;
    else if (isValidElement(node)) {
      const child = childrenOf(node);
      if (typeof child === "string" || typeof child === "number") out += String(child);
      else if (isValidElement(child)) out += String(childrenOf(child) ?? "");
    }
  }
  return out;
}

describe("renderBuzzSummary (inline press citations)", () => {
  it("turns an in-range [n] marker into a superscript link to its mention", () => {
    const sups = elements(
      renderBuzzSummary("A cracking roast [1] and a great pint [2].", mentions),
    );
    expect(sups).toHaveLength(2);

    const anchor = childrenOf(sups[0]!);
    expect(isValidElement(anchor)).toBe(true);
    const a = anchor as ReactElement;
    expect(a.type).toBe("a");
    expect((a.props as { href: string }).href).toBe("https://theinfatuation.com/london/x");
    expect((a.props as { children: unknown }).children).toBe(1);
  });

  it("never leaves a raw [n] bracket in the rendered text", () => {
    const nodes = renderBuzzSummary("Loved it [1][2][3] honestly.", mentions);
    expect(textOf(nodes)).not.toMatch(/\[\d+\]/);
  });

  it("renders an out-of-range or non-https marker as a plain superscript, no dead link", () => {
    // [3] is a non-https mention; [9] is out of range. Neither becomes a link.
    const sups = elements(renderBuzzSummary("See [3] and also [9].", mentions));
    expect(sups).toHaveLength(2);
    for (const sup of sups) {
      expect(sup.type).toBe("sup");
      // plain numeric child (a number), not an <a> element
      expect(typeof childrenOf(sup)).toBe("number");
    }
  });

  it("preserves surrounding prose verbatim", () => {
    const nodes = renderBuzzSummary("Great spot [1] near the park.", mentions);
    expect(textOf(nodes)).toBe("Great spot 1 near the park.");
  });
});
