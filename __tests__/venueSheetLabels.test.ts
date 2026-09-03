import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { venueSheetLabels } from "@/lib/venueSheetLabels";
import type { Venue } from "@/lib/venues";

const pubMapSource = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");

describe("venueSheetLabels", () => {
  it("uses generic venue language before a selected venue is known", () => {
    expect(venueSheetLabels(null)).toEqual({
      typeLabel: "Venue",
      summaryLabel: "Selected venue summary",
      detailLabel: "Venue detail",
      closeLabel: "Close venue detail",
      loadingLabel: "Loading full venue details…",
      unavailableLabel:
        "Showing fast map details. Full venue notes are unavailable right now.",
    });
  });

  it("preserves backward-compatible pub language for legacy venues", () => {
    expect(venueSheetLabels({ kind: undefined } as Venue)).toMatchObject({
      typeLabel: "Pub",
      summaryLabel: "Selected pub summary",
      detailLabel: "Pub detail",
      closeLabel: "Close pub detail",
    });
  });

  it("keeps the mobile location summary as one clear label and support line", () => {
    expect(pubMapSource).toContain('"Near me"');
    expect(pubMapSource).toContain('"Turn on location for walk times"');
    expect(pubMapSource).not.toContain('"for walk time"');
  });

  it.each([
    [
      "bar",
      {
        typeLabel: "Bar",
        summaryLabel: "Selected bar summary",
        detailLabel: "Bar detail",
        closeLabel: "Close bar detail",
        loadingLabel: "Loading full bar details…",
        unavailableLabel:
          "Showing fast map details. Full bar notes are unavailable right now.",
      },
    ],
    [
      "food",
      {
        typeLabel: "Late food",
        summaryLabel: "Selected late-food venue summary",
        detailLabel: "Late-food venue detail",
        closeLabel: "Close late-food venue detail",
        loadingLabel: "Loading full late-food venue details…",
        unavailableLabel:
          "Showing fast map details. Full late-food venue notes are unavailable right now.",
      },
    ],
  ] as const)("uses kind-honest selected-sheet copy for %s venues", (kind, expected) => {
    expect(venueSheetLabels({ kind } as Venue)).toEqual(expected);
  });
});
