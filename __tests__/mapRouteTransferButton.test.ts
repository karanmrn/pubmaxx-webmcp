import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapRouteTransferButton, type MapRouteResponse } from "@/components/plan/MapRouteTransferButton";

const response: MapRouteResponse = {
  groundingProof: "payload.signature",
  operationKey: "operation-1",
  stops: [{ venueId: "venue-a", venueName: "Venue A", alternatives: [] }],
};

describe("MapRouteTransferButton", () => {
  it("renders the byte-identical legacy CTA with the flag off or no captured Route", () => {
    const flagOff = renderToStaticMarkup(createElement(MapRouteTransferButton, { response, mapRouteTransfer: false }));
    const noRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response: null, mapRouteTransfer: true }));

    expect(flagOff).toContain('href="/plan?src=mobile-route-preview"');
    expect(flagOff).toContain("Open Plan to lock it in");
    expect(noRoute).toBe(flagOff);
  });

  it("keeps the identical navigation target with the flag on — the transfer rides the click, not a re-render", () => {
    const flagOn = renderToStaticMarkup(createElement(MapRouteTransferButton, { response, mapRouteTransfer: true }));
    const flagOff = renderToStaticMarkup(createElement(MapRouteTransferButton, { response, mapRouteTransfer: false }));

    expect(flagOn).toContain('href="/plan?src=mobile-route-preview"');
    expect(flagOn).toBe(flagOff);
  });
});
