// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenuePriceStory from "@/components/map/VenuePriceStory";
import type { VenuePriceStoryDrop } from "@/lib/thenVsNow";
import type { Venue } from "@/lib/venues";

type PendingResponse = {
  url: string;
  resolve: (response: Response) => void;
};

function venue(id: string, name: string, cheapestPrice: number): Venue {
  return {
    id,
    name,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPint: "Lager",
    averagePrice: cheapestPrice,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    kind: "pub",
  };
}

function currentDrop(venueId: string, priceGbp: number): VenuePriceStoryDrop {
  return {
    venueId,
    priceGbp,
    createdAt: "2026-08-27T12:00:00.000Z",
    era: "",
    handle: "alice",
    provenance: "contributor",
  };
}

let host: HTMLDivElement;
let root: Root;
let pending: PendingResponse[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        pending.push({ url: String(input), resolve });
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("VenuePriceStory request identity", () => {
  it("clears the previous venue confidence while the next venue story resolves", async () => {
    const firstVenue = venue("venue-a", "First Arms", 5);
    const secondVenue = venue("venue-b", "Second Arms", 5.5);

    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: firstVenue,
          drops: [currentDrop(firstVenue.id, 6)],
        }),
      );
    });

    expect(pending[0]?.url).toContain("venueId=venue-a");
    await act(async () => {
      pending[0]?.resolve(
        Response.json({
          confirms: 3,
          recentConfirms: 3,
          lastConfirmedAt: Date.now(),
        }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[class*="vpsConfidence-"]')).not.toBeNull();

    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: secondVenue,
          drops: [currentDrop(secondVenue.id, 7)],
        }),
      );
    });

    expect(pending[1]?.url).toContain("venueId=venue-b");
    expect(host.textContent).toContain("£7.00");
    expect(host.querySelector('[class*="vpsConfidence-"]')).toBeNull();
  });

  it("ignores a late response from the previously selected venue", async () => {
    const firstVenue = venue("venue-a", "First Arms", 5);
    const secondVenue = venue("venue-b", "Second Arms", 5.5);

    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: firstVenue,
          drops: [currentDrop(firstVenue.id, 6)],
        }),
      );
    });
    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: secondVenue,
          drops: [currentDrop(secondVenue.id, 7)],
        }),
      );
    });

    await act(async () => {
      pending[1]?.resolve(
        Response.json({ confirms: 0, recentConfirms: 0, lastConfirmedAt: null }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[class*="vpsConfidence-"]')).toBeNull();

    await act(async () => {
      pending[0]?.resolve(
        Response.json({
          confirms: 3,
          recentConfirms: 3,
          lastConfirmedAt: Date.now(),
        }),
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("£7.00");
    expect(host.querySelector('[class*="vpsConfidence-"]')).toBeNull();
  });

  it("clears confidence when the active price changes at the same venue", async () => {
    const activeVenue = venue("venue-a", "First Arms", 5);

    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: activeVenue,
          drops: [currentDrop(activeVenue.id, 6)],
        }),
      );
    });
    await act(async () => {
      pending[0]?.resolve(
        Response.json({
          confirms: 3,
          recentConfirms: 3,
          lastConfirmedAt: Date.now(),
        }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[class*="vpsConfidence-"]')).not.toBeNull();

    await act(async () => {
      root.render(
        createElement(VenuePriceStory, {
          venue: activeVenue,
          drops: [currentDrop(activeVenue.id, 6.5)],
        }),
      );
    });

    expect(pending[1]?.url).toContain("priceGbp=6.5");
    expect(host.textContent).toContain("£6.50");
    expect(host.querySelector('[class*="vpsConfidence-"]')).toBeNull();
  });
});
