import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorialRailView } from "@/components/out/EditorialRail";
import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_DEGRADED_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_RAIL_TITLE,
  EDITORIAL_STALE_LINE,
} from "@/lib/editorial";
import { OUT_MAP_WAY, OUT_RETRY_LABEL } from "@/lib/out/outStatus";
import type { EditorialSnapshot } from "@/lib/editorial";

const OUT_CLIENT = readFileSync(join(process.cwd(), "app/out/OutClient.tsx"), "utf8");
const TONIGHT = readFileSync(join(process.cwd(), "app/tonight/TonightClient.tsx"), "utf8");
const MAP = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const RAIL_CSS = readFileSync(join(process.cwd(), "components/out/editorialRail.css"), "utf8");

const readyItems: EditorialSnapshot = {
  version: 1,
  generatedAt: "2026-08-16T10:00:00.000Z",
  status: "ready",
  items: [
    {
      source_id: "leytonstoner",
      title: "Point Taproom opens",
      canonical_url: "https://leytonstoner.substack.com/p/point",
      published_at: "2026-08-16T09:00:00.000Z",
      excerpt: "A new tap in Leytonstone.",
      attribution_label: "Leytonstoner",
    },
    {
      source_id: "gla-80117",
      title: "Diwali on the Square",
      canonical_url: "https://www.london.gov.uk/events/diwali",
      published_at: "2026-08-15T09:00:00.000Z",
      excerpt: "A civic night.",
      attribution_label: "Greater London Authority",
    },
  ],
};

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

function html(snapshot: EditorialSnapshot) {
  return renderToStaticMarkup(
    createElement(EditorialRailView, { snapshot, now: NOW, onRetry: () => undefined }),
  );
}

describe("editorial rail", () => {
  it("renders credited link-outs, never a start time PUBMAXX invented", () => {
    const markup = html(readyItems);
    expect(markup).toContain(EDITORIAL_RAIL_TITLE);
    expect(markup).toContain('href="https://leytonstoner.substack.com/p/point"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("via Leytonstoner");
    expect(markup).toContain("via Greater London Authority");
    expect(markup).toContain(
      "Contains public sector information licensed under the Open Government Licence v3.0.",
    );
    expect(markup).toContain(
      'href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"',
    );
    expect(markup).not.toMatch(/09:00/);
    expect(markup).not.toMatch(/starts/i);
    expect(markup).not.toMatch(/observed/i);
  });

  it("hides stale picks and names the stale snapshot state", () => {
    const markup = renderToStaticMarkup(
      createElement(EditorialRailView, {
        snapshot: {
          ...readyItems,
          generatedAt: "2026-08-13T10:00:00.000Z",
        },
        now: NOW,
        onRetry: () => undefined,
      }),
    );
    expect(markup).toContain(EDITORIAL_STALE_LINE);
    // Reader-facing, never our maintenance: it says what they get without
    // claiming the week is empty, which a withheld snapshot cannot know.
    expect(EDITORIAL_STALE_LINE).not.toMatch(/check|refresh|stale|snapshot/i);
    expect(markup).not.toContain("Point Taproom opens");
  });

  it("says a quiet week honestly, and a failed read as a failed read", () => {
    expect(
      html({
        version: 1,
        generatedAt: "2026-08-16T10:00:00.000Z",
        status: "ready",
        items: [],
      }),
    ).toContain(EDITORIAL_EMPTY_LINE);
    expect(
      html({
        version: 1,
        generatedAt: "2026-08-16T10:00:00.000Z",
        status: "degraded",
        items: readyItems.items,
      }),
    ).toContain(EDITORIAL_DEGRADED_LINE);
    expect(
      html({
        version: 1,
        generatedAt: "2026-08-16T10:00:00.000Z",
        status: "degraded",
        items: [],
      }),
    ).toContain(EDITORIAL_DEGRADED_EMPTY_LINE);
  });

  it("retries a failed empty read and opens the map for an answered empty read", () => {
    const quiet = html({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "ready",
      items: [],
    });
    const failed = html({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "degraded",
      items: [],
    });

    expect(quiet).toContain(OUT_MAP_WAY.label);
    expect(quiet).toContain(`href="${OUT_MAP_WAY.href}"`);
    expect(quiet).not.toContain(OUT_RETRY_LABEL);
    expect(failed).toContain(OUT_RETRY_LABEL);
    expect(failed).not.toContain(OUT_MAP_WAY.label);
    expect(failed).not.toContain(`href="${OUT_MAP_WAY.href}"`);
  });

  it("sits on /out and /tonight, never on the map cold-open", () => {
    expect(OUT_CLIENT).toMatch(/EditorialRail/);
    expect(TONIGHT).toMatch(/EditorialRail/);
    expect(MAP).not.toMatch(/EditorialRail|editorial/);
  });

  it("is reduced-motion safe", () => {
    expect(RAIL_CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(RAIL_CSS).toMatch(/animation:\s*none/);
  });
});
