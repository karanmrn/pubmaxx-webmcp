import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AnswerCard } from "@/components/pal/PalChat";
import type { PalCard } from "@/lib/palChat";
import { resolvePalLocality } from "@/lib/palLocality";

function card(overrides: Partial<PalCard> = {}): PalCard {
  return {
    key: "v-1",
    venueId: "venue-a",
    title: "The Anchor",
    place: "Brixton",
    note: "In Brixton, within budget",
    price: 4.5,
    provenance: { label: "On record", kind: "directory" },
    ...overrides,
  };
}

const noop = (_venueId: string) => {};

describe("Pub Pal card acceptance handoff", () => {
  it("offers an explicit source-pal acceptance to Map when palHandoff is on", () => {
    const locality = resolvePalLocality("cheap in Brixton", null);
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card(), onOpen: noop, palHandoff: true, locality }));
    expect(html).toContain("Use this Venue");
    expect(html).toContain("/map?sel=venue-a&amp;accept=1&amp;src=pal");
    // The browse deep-link stays available and browse-only alongside it.
    expect(html).toContain("/map?sel=venue-a");
  });

  it("stays browse-only with no acceptance affordance when palHandoff is off (byte-identical)", () => {
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card(), onOpen: noop, palHandoff: false, locality: null }));
    expect(html).not.toContain("Use this Venue");
    expect(html).not.toContain("accept=1");
    expect(html).not.toContain("src=pal");
    expect(html).toContain("/map?sel=venue-a");
  });

  it("shows no acceptance for a card that does not deep-link to a Venue", () => {
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card({ venueId: "" }), onOpen: noop, palHandoff: true, locality: null }));
    expect(html).not.toContain("Use this Venue");
    expect(html).not.toContain("accept=1");
  });

  it("keeps the provenance link outside the venue link", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCard, {
        card: card({
          provenance: {
            label: "Skiddle",
            kind: "whats-on",
            url: "https://example.test/event",
          },
        }),
        onOpen: noop,
        palHandoff: false,
        locality: null,
      }),
    );
    expect(html).toContain('href="/map?sel=venue-a"');
    expect(html).toContain('href="https://example.test/event"');
    const venueOpen = html.search(/<a[^>]*href="\/map\?sel=venue-a"/);
    expect(venueOpen).toBeGreaterThanOrEqual(0);
    const venueTagEnd = html.indexOf(">", venueOpen);
    const firstClose = html.indexOf("</a>", venueTagEnd);
    expect(html.slice(venueTagEnd, firstClose)).not.toContain("https://example.test/event");
  });
});
