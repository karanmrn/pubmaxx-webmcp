import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

function render(props: Parameters<typeof PubmaxxWordmark>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxWordmark, props));
}

describe("PUBMAXX wordmark", () => {
  it("renders the canonical visible brand as readable PUBMAXX text", () => {
    const html = render();
    const letters = html.match(
      /<span class="pubmaxxWordmarkLetters"[\s\S]*?<\/span><\/span><\/span>/,
    )?.[0] ?? "";

    expect(letters, "visible letter lockup is present").not.toBe("");
    expect(letters).toContain(">PUBMAX</span>");
    expect(letters).toContain('class="pubmaxxWordmarkAccent">X</span>');
    expect(letters).not.toContain("ING");
    expect(letters).not.toContain("<svg");
  });

  it("uses the canonical brand name for assistive technology", () => {
    const html = render();

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="PUBMAXX"');
    expect(html).toContain('class="pubmaxxWordmarkSr">PUBMAXX</span>');
    expect(html).not.toContain("PUBMAXXING");
  });

  it("keeps the mark lockup API intact", () => {
    const html = render({ withMark: true, markVariant: "duo", markSize: 22 });

    expect(html).toContain('class="pubmaxxLockup"');
    expect(html).toContain('class="pubmaxxMark"');
    expect(html).toContain('width="22"');
    expect(html).toContain('class="pubmaxxWordmark"');
  });
});
