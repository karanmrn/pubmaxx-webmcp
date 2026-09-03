import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoundSpendHistory } from "@/app/rounds/[code]/RoundPageClient";
import {
  resolveRoundPromotionStatus,
  type RoundPromotionStatus,
  type RoundSpendDTO,
} from "@/lib/rounds";

function spend(promotionStatus: RoundPromotionStatus): RoundSpendDTO {
  return {
    id: `spend-${promotionStatus}`,
    clientRef: `ref-${promotionStatus}`,
    payerHandle: "ken",
    recordedByHandle: "ken",
    venueId: "venue-1",
    venueName: "The Ship",
    totalPence: 620,
    items: [
      {
        drinkName: "Guinness",
        drinkCategory: "beer",
        pricePence: 620,
        source: "round",
        promotionStatus,
      },
    ],
    recordedAt: "2026-07-29T20:00:00.000Z",
  };
}

describe("Round spend history", () => {
  it("claims community-price status only for explicitly promoted lines", () => {
    const diary = renderToStaticMarkup(
      createElement(RoundSpendHistory, { spends: [spend("diary_only")] }),
    );
    expect(diary).toContain("diary only");
    expect(diary).not.toContain("stays provisional");

    const promoted = renderToStaticMarkup(
      createElement(RoundSpendHistory, { spends: [spend("promoted")] }),
    );
    expect(promoted).toContain("stays provisional");
    expect(promoted).not.toContain("diary only");
  });

  it("keeps legacy promotion outcomes neutral", () => {
    const legacy = renderToStaticMarkup(
      createElement(RoundSpendHistory, {
        spends: [spend("legacy_unknown")],
      }),
    );

    expect(legacy).toContain("sharing status unknown");
    expect(legacy).not.toContain("diary only");
    expect(legacy).not.toContain("stays provisional");
    expect(resolveRoundPromotionStatus("round", undefined)).toBe(
      "legacy_unknown",
    );
    expect(resolveRoundPromotionStatus("demo", undefined)).toBe("diary_only");
  });

  it("labels an overwritten Round line as superseded, not diary only", () => {
    const superseded = renderToStaticMarkup(
      createElement(RoundSpendHistory, {
        spends: [spend("superseded")],
      }),
    );

    expect(superseded).toContain("superseded by a later price");
    expect(superseded).not.toContain("diary only");
    expect(superseded).not.toContain("stays provisional");
    expect(resolveRoundPromotionStatus("round", "superseded")).toBe(
      "superseded",
    );
  });
});
