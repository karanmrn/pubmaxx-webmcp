import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NearbyBusDepartures, {
  busDeparturesAnnouncement,
  busDeparturesStaleness,
  NearbyBusDeparturesView,
  nearbyBusDeparturesFetchUrl,
  shouldOfferBusRetry,
} from "@/components/map/NearbyBusDepartures";
import type { NearbyBusDeparturesResult } from "@/lib/nearbyBusDepartures";

const unavailable: NearbyBusDeparturesResult = {
  status: "unavailable",
  generatedAt: "2026-07-28T22:40:00.000Z",
  stops: [],
};

const result: NearbyBusDeparturesResult = {
  status: "ready",
  generatedAt: "2026-07-28T22:40:00.000Z",
  stops: [
    {
      id: "490000123B",
      name: "Blackfriars Station",
      indicator: "Stop B",
      towards: "King's Cross",
      distanceM: 140,
      departures: [
        {
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ],
    },
  ],
};

function render(at: string, shown: NearbyBusDeparturesResult = result): string {
  return renderToStaticMarkup(
    createElement(NearbyBusDeparturesView, { result: shown, now: new Date(at) }),
  );
}

function arrivingAt(iso: string): NearbyBusDeparturesResult {
  return {
    ...result,
    stops: [
      {
        ...result.stops[0],
        departures: [{ ...result.stops[0].departures[0], expectedArrival: iso }],
      },
    ],
  };
}

describe("NearbyBusDepartures", () => {
  it("starts as one collapsed getting-home control without preloading departures", () => {
    const html = renderToStaticMarkup(
      createElement(NearbyBusDepartures, { lat: 51.512, lng: -0.104 }),
    );

    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Buses nearby");
    expect(html).not.toContain("King&#x27;s Cross");
    expect(nearbyBusDeparturesFetchUrl(51.512, -0.104)).toBe(
      "/api/nearby-bus-departures?lat=51.512&lng=-0.104",
    );
  });

  it("shows stop distance, stop direction, service direction, and due time", () => {
    const html = render("2026-07-28T22:40:00.000Z");

    expect(html).toContain("Blackfriars Station");
    expect(html).toContain("Stop B");
    expect(html).toContain("towards King&#x27;s Cross");
    expect(html).toContain("140 m from here, straight line");
    expect(html).toContain("Outbound to King&#x27;s Cross");
    expect(html).toContain(">3 min<");
    expect(html).not.toMatch(/\bwalk\b/i);
  });

  it("words the card for any kind of venue it is shown on", () => {
    const card = renderToStaticMarkup(
      createElement(NearbyBusDepartures, { lat: 51.512, lng: -0.104 }),
    );

    expect(card).toContain("stops near here");
    expect(card).not.toMatch(/\bpub\b/i);
    expect(render("2026-07-28T22:40:00.000Z")).not.toMatch(/\bpub\b/i);
  });

  it("counts a departure down as time passes instead of freezing what it first said", () => {
    expect(render("2026-07-28T22:40:00.000Z")).toContain(">3 min<");
    expect(render("2026-07-28T22:41:10.000Z")).toContain(">2 min<");
    expect(
      render("2026-07-28T22:41:10.000Z", arrivingAt("2026-07-28T22:41:00.000Z")),
    ).toContain(">Due<");
  });

  it("names the age of a check that is getting on", () => {
    const html = render("2026-07-28T22:41:10.000Z");

    expect(html).toContain("Checked about a minute ago");
    expect(html).not.toMatch(/out of date/i);
  });

  it("stops counting down once the check is too old to stand behind", () => {
    const html = render("2026-07-28T22:43:30.000Z");

    expect(html).toContain("These times are out of date");
    expect(html).toContain("Checked about 3 minutes ago");
    expect(html).toContain(">23:43<");
    expect(html).not.toMatch(/\d+ min</);
    expect(html).not.toContain(">Due<");
  });

  it("writes unavailable as a failed check rather than an absence of buses", () => {
    const html = render("2026-07-28T22:40:00.000Z", unavailable);

    expect(html).toContain("Couldn&#x27;t check nearby buses just now");
    expect(html).not.toMatch(/no buses/i);
  });

  it("announces the load, never the ticking countdown", () => {
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: null,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe("Checking live departures.");
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe("Nearby bus departures are ready.");
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: unavailable,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe("Couldn't check nearby buses just now.");
    expect(
      busDeparturesAnnouncement({
        polling: false,
        result: null,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe("");
  });

  it("keeps the announcement steady while the minutes underneath it move", () => {
    const early = busDeparturesAnnouncement({
      polling: true,
      result,
      waitedTooLong: false,
      retryPending: false,
    });

    expect(render("2026-07-28T22:40:00.000Z")).toContain(">3 min<");
    expect(render("2026-07-28T22:41:10.000Z")).toContain(">2 min<");
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result,
        waitedTooLong: true,
        retryPending: false,
      }),
    ).toBe(early);
  });

  it("says once that the times stopped being vouched for", () => {
    const at = (iso: string) =>
      busDeparturesAnnouncement({
        polling: true,
        result,
        waitedTooLong: false,
        retryPending: false,
        staleness: busDeparturesStaleness(result, new Date(iso)),
      });

    // Live and ageing are the same sentence, so a card left open through the
    // fifteen second tick and the "checked a minute ago" note stays quiet.
    expect(at("2026-07-28T22:40:20.000Z")).toBe("Nearby bus departures are ready.");
    expect(at("2026-07-28T22:41:10.000Z")).toBe("Nearby bus departures are ready.");

    // Going out of date is the one transition worth interrupting for, and it
    // carries no age in minutes, so it is said once and not once a minute.
    const stale = "These bus times are out of date. Check the stop display before you set off.";
    expect(at("2026-07-28T22:42:30.000Z")).toBe(stale);
    expect(at("2026-07-28T22:45:30.000Z")).toBe(stale);
    expect(at("2026-07-28T22:59:30.000Z")).toBe(stale);
  });

  it("reads staleness only off departures that are actually on screen", () => {
    const now = new Date("2026-07-28T22:45:00.000Z");

    expect(busDeparturesStaleness(null, now)).toBe(null);
    expect(busDeparturesStaleness(unavailable, now)).toBe(null);
    expect(busDeparturesStaleness(result, now)).toBe("out-of-date");
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: unavailable,
        waitedTooLong: false,
        retryPending: false,
        staleness: null,
      }),
    ).toBe("Couldn't check nearby buses just now.");
  });

  it("keeps the announcement steady when a refresh changes the counts", () => {
    const busier: NearbyBusDeparturesResult = {
      ...result,
      generatedAt: "2026-07-28T22:40:30.000Z",
      stops: [
        result.stops[0],
        { ...result.stops[0], id: "490000123C", name: "Ludgate Circus" },
      ],
    };

    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: busier,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe(
      busDeparturesAnnouncement({
        polling: true,
        result,
        waitedTooLong: false,
        retryPending: false,
      }),
    );
  });

  it("says a requested check is running, over any result it is replacing", () => {
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: unavailable,
        waitedTooLong: true,
        retryPending: true,
      }),
    ).toBe("Checking live departures.");
    expect(
      busDeparturesAnnouncement({
        polling: true,
        result: null,
        waitedTooLong: true,
        retryPending: true,
      }),
    ).toBe("Checking live departures.");
  });

  it("puts the one live region outside the text that re-words every tick", () => {
    const card = renderToStaticMarkup(
      createElement(NearbyBusDepartures, { lat: 51.512, lng: -0.104 }),
    );

    expect(card).toContain('class="nearbyBusAnnouncement" role="status"');
    expect(render("2026-07-28T22:41:10.000Z")).not.toContain('role="status"');
    expect(render("2026-07-28T22:43:30.000Z")).not.toContain('role="status"');
    expect(render("2026-07-28T22:40:00.000Z", unavailable)).not.toContain(
      'role="status"',
    );
  });

  it("offers a retry once a check has failed, and not before", () => {
    expect(
      shouldOfferBusRetry({
        polling: true,
        result: null,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferBusRetry({
        polling: true,
        result: null,
        waitedTooLong: true,
        retryPending: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferBusRetry({
        polling: true,
        result: unavailable,
        waitedTooLong: false,
        retryPending: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferBusRetry({
        polling: true,
        result,
        waitedTooLong: true,
        retryPending: false,
      }),
    ).toBe(false);
    // The control stays put while its own check runs, so nothing shifts under
    // the thumb that pressed it. The component disables it for that stretch.
    expect(
      shouldOfferBusRetry({
        polling: true,
        result: unavailable,
        waitedTooLong: false,
        retryPending: true,
      }),
    ).toBe(true);
  });

  it("keeps the retry control thumb-sized, and refuses without taking focus", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/nearbyBusDepartures.css"),
      "utf8",
    );
    const retryRule = css.match(/\.nearbyBusRetry\s*{([^}]*)}/)?.[1] ?? "";
    const source = readFileSync(
      join(process.cwd(), "components/map/NearbyBusDepartures.tsx"),
      "utf8",
    );

    expect(retryRule).toMatch(/min-height:\s*44px/);
    expect(retryRule).toMatch(/min-width:\s*44px/);
    // A `disabled` button loses the focus the reader put on it, and nothing
    // gives it back. aria-disabled keeps the control and its name, so the
    // refusal has to live in the handler.
    expect(source).toContain("aria-disabled={retryPending}");
    expect(source).not.toMatch(/[^-]disabled=\{retryPending\}/);
    expect(source).toMatch(/function retry\(\) \{[\s\S]*?if \(retryPending\) return;/);
    expect(css).toContain('.nearbyBusRetry[aria-disabled="true"]');
    expect(css).not.toContain(".nearbyBusRetry:disabled");
    expect(source).toContain("setRetryPending(false)");
  });

  it("keeps the summary thumb-sized and adds no motion", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/nearbyBusDepartures.css"),
      "utf8",
    );
    const summaryRule =
      css.match(/\.nearbyBusDeparturesSummary\s*{([^}]*)}/)?.[1] ?? "";

    expect(summaryRule).toMatch(/min-height:\s*44px/);
    expect(css).not.toMatch(/\banimation\s*:/);
    expect(css).not.toMatch(/\btransition\s*:/);
  });
});
