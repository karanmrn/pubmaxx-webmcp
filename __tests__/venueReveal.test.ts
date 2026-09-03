import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
import {
  revealForm,
  venuePriceRevealMotion,
  venuePriceRevealMotionClass,
  venueRevealRootClasses,
  VENUE_REVEAL_STALE_MS,
} from "@/lib/venueReveal";

const NOW = Date.UTC(2026, 7, 25, 20, 0, 0);

describe("revealForm", () => {
  it("returns full when there is no prior reveal", () => {
    expect(revealForm(NOW, null)).toBe("full");
  });

  it("returns full when the last reveal is stale", () => {
    expect(revealForm(NOW, NOW - VENUE_REVEAL_STALE_MS)).toBe("full");
  });

  it("returns short when the last reveal is recent", () => {
    expect(revealForm(NOW, NOW - 2_000)).toBe("short");
  });
});

describe("venuePriceRevealMotion", () => {
  const established = {
    corroborations: 2,
    submittedAt: NOW - 60_000,
    mapCandidate: null,
  };

  const provisional = {
    corroborations: 1,
    submittedAt: NOW - 60_000,
    mapCandidate: null,
  };

  it("drops only corroborated in-window community figures", () => {
    expect(
      venuePriceRevealMotion({ communityLead: established }, NOW),
    ).toBe("drop");
  });

  it("slides provisional in-window figures flat", () => {
    expect(
      venuePriceRevealMotion({ communityLead: provisional }, NOW),
    ).toBe("slide");
  });

  it("uses the rendered provisional row over an older map candidate", () => {
    expect(
      venuePriceRevealMotion(
        {
          communityLead: {
            ...provisional,
            mapCandidate: {
              priceGbp: 4.2,
              submittedAt: NOW - 60_000,
              corroborations: 2,
            },
          },
        },
        NOW,
      ),
    ).toBe("slide");
  });

  it("stays static when there is no community lead", () => {
    expect(venuePriceRevealMotion({ communityLead: null }, NOW)).toBe("static");
  });

  it("stays static when the only row is aged out", () => {
    expect(
      venuePriceRevealMotion(
        {
          communityLead: {
            ...established,
            submittedAt: NOW - 31 * 24 * 60 * 60 * 1000,
          },
        },
        NOW,
      ),
    ).toBe("static");
  });
});

describe("venuePriceRevealMotionClass", () => {
  it("maps motion to chrome classes, never the figure node", () => {
    expect(venuePriceRevealMotionClass("drop")).toBe(
      "venueRevealPriceChrome--drop",
    );
    expect(venuePriceRevealMotionClass("slide")).toBe(
      "venueRevealPriceChrome--slide",
    );
    expect(venuePriceRevealMotionClass("static")).toBe(
      "venueRevealPriceChrome--static",
    );
  });
});

describe("venueRevealRootClasses", () => {
  it("omits entrance classes when interrupted", () => {
    expect(
      venueRevealRootClasses({ active: true, form: "full", interrupted: true }),
    ).toBe("");
  });

  it("names the active form when running", () => {
    expect(
      venueRevealRootClasses({ active: true, form: "short", interrupted: false }),
    ).toBe("venueReveal venueReveal--short");
  });
});

describe("VenueSheetSkeleton", () => {
  it("uses the reveal root for the loading bloom", () => {
    const html = renderToStaticMarkup(
      createElement(VenueSheetSkeleton, { revealForm: "full", revealElapsedMs: 300 }),
    );
    expect(html).toContain(
      'class="venueSheetSkeleton venueReveal venueReveal--full"',
    );
    expect(html).toContain('style="--venue-reveal-elapsed:300ms"');
    expect(html).toContain('class="venueSheetSkeletonTitle venueRevealBloom"');
  });
});
