import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane, {
  dealsTonightRowsFromResponse,
  type DealsTonightLaneProps,
} from "@/components/discovery/DealsTonightLane";
import { londonServiceDayBounds } from "@/lib/whatsOn";
import type { WhatsOnRow } from "@/lib/whatsOn";

const DEAL_QUALIFIER =
  "Two pints for £12 before 7pm on Thursdays. Booking excludes match nights, bank holidays, and the terrace.";

// A deal that has closed never renders (deal grace is 0, lib/dealsHonesty.ts),
// so these fixtures date themselves off tonight's own window. A fixed calendar
// date would quietly stop exercising the caption the day it went past.
// A closing time inside the window is a closing time the wall clock walks past:
// end - 1h closed at 03:00 London while the service day ran to 04:00. The
// fixtures that read the real clock therefore run to the window's own close.
function tonightWindow(now: number = Date.now()) {
  const bounds = londonServiceDayBounds(now);
  const at = (hoursIn: number) =>
    new Date(Date.parse(bounds.start) + hoursIn * 60 * 60 * 1000).toISOString();
  return { at, closesAt: bounds.end };
}

describe("DealsTonightLane caption", () => {
  it("renders a legitimate deal condition without changing its text", () => {
    // The lane reads a clock on every render and deal grace is 0, so a fixture
    // that opens at the window's start + 2h closed at the window's start + 4h
    // and rendered nothing from 20:00 London onwards. Pin the lane's own clock
    // inside the fixture's hours instead of borrowing the wall clock.
    const serviceWindow = londonServiceDayBounds();
    const at = (hoursIn: number) =>
      Date.parse(serviceWindow.start) + hoursIn * 60 * 60 * 1000;
    const startsAt = new Date(at(2)).toISOString();
    const endsAt = new Date(at(4)).toISOString();
    const now = at(3);
    const observedAt = new Date(now - 60 * 60 * 1000).toISOString();

    const props: DealsTonightLaneProps = {
      now,
      rows: [
        {
          id: "caption-integrity-deal",
          venueId: "venue-xjf3n0",
          placeName: "Arnos Arms, Arnos Grove",
          kind: "deal",
          startsAt,
          endsAt,
          title: "Early round offer",
          detail: DEAL_QUALIFIER,
          source: { label: "Venue listing", url: "https://example.com/deal" },
          observedAt,
          confidence: "listed",
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(
        DealsTonightLane as ComponentType<DealsTonightLaneProps>,
        props,
      ),
    );

    expect(html).toContain(`class="dealsTonightDetail">${DEAL_QUALIFIER}</span>`);
  });

  it("derives the Tonight host-provided claim from the deal cards shown", () => {
    const observedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { at, closesAt } = tonightWindow();
    const props: { rows: WhatsOnRow[] } = {
      rows: [
        {
          id: "dated-card-undated-lane",
          venueId: "venue-xjf3n0",
          placeName: "Arnos Arms, Arnos Grove",
          kind: "deal",
          startsAt: at(0),
          endsAt: closesAt,
          title: "Early round offer",
          detail: "Listed time: tonight, 18:00-19:30.",
          source: { label: "Venue listing", url: "https://example.com/deal" },
          observedAt,
          confidence: "listed",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(
        DealsTonightLane,
        props,
      ),
    );

    expect(html).toContain('class="dealsTonightChecked">1 listed deal</span>');
    expect(html).not.toContain("No date on this yet");
  });

  it("counts only the deal cards that the Tonight lane renders", () => {
    const observedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { at, closesAt } = tonightWindow();
    const dealRows: WhatsOnRow[] = Array.from({ length: 9 }, (_, index) => ({
      id: `deal-${index}`,
      placeName: `Venue ${index}`,
      kind: "deal",
      startsAt: at(0),
      endsAt: closesAt,
      title: `Deal ${index}`,
      source: { label: "Venue listing", url: "https://example.com/deal" },
      observedAt,
      confidence: "listed",
    }));
    const musicRow: WhatsOnRow = {
      ...dealRows[0]!,
      id: "music-1",
      kind: "music",
      title: "Live music",
    };

    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, { rows: [...dealRows, musicRow] }),
    );

    expect(html).toContain('class="dealsTonightChecked">8 listed deals</span>');
    expect(html.match(/class="dealsTonightCard"/g)).toHaveLength(8);
    expect(html).not.toContain("Live music");
  });

  it("derives the Discover claim from validated response cards without asOf", () => {
    const { at, closesAt } = tonightWindow();
    const rows = dealsTonightRowsFromResponse({
      rows: [{
        id: "discover-dated-deal",
        venueId: "venue-xjf3n0",
        placeName: "Arnos Arms, Arnos Grove",
        kind: "deal",
        startsAt: at(0),
        endsAt: closesAt,
        title: "Early round offer",
        source: { label: "Venue listing", url: "https://example.com/deal" },
        observedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        confidence: "listed",
      }],
    });

    const html = renderToStaticMarkup(createElement(DealsTonightLane, { rows }));

    expect(html).toContain('class="dealsTonightChecked">1 listed deal</span>');
    expect(html.match(/class="dealsTonightCard"/g)).toHaveLength(1);
    expect(html).not.toContain("No date on this yet");
  });
});
