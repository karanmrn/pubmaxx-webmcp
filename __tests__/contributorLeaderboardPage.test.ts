import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributorRecord from "@/components/contributors/ContributorRecord";
import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

function render(board: ContributorLeaderboard): string {
  return renderToStaticMarkup(createElement(ContributorRecord, { board }));
}

describe("ContributorRecord", () => {
  it("labels the all-time window and presents equal totals as joint ranks", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [
        {
          rank: 1,
          handle: "alex",
          total: 2,
          prices: 0,
          reviews: 1,
          recommendations: 1,
        },
        {
          rank: 1,
          handle: "sam",
          total: 2,
          prices: 1,
          reviews: 1,
          recommendations: 0,
        },
      ],
    });

    expect(html).toContain("Contributor record");
    expect(html).toContain(
      "All visible identity-backed contributions, all time",
    );
    expect(html.match(/class="contributorRank"[^>]*>1</g)).toHaveLength(2);
    expect(html).toContain('href="/u/alex"');
    expect(html).toContain("Prices");
    expect(html).toContain("Visit Reports");
    expect(html).toContain("Recommendations");
    expect(html).toContain("Legacy price logs without a handle are not ranked");
    expect(html).toContain("Only identity-backed contributions are ranked");
    expect(html).not.toMatch(/winner|points|score/i);
  });

  it("states a failed read without turning it into contributor absence", () => {
    const html = render({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });

    expect(html).toContain("All-time record unavailable");
    expect(html).toContain(
      "couldn&#x27;t check the full identity-backed record",
    );
    expect(html).toContain("Only identity-backed contributions are ranked");
    expect(html).not.toMatch(/no contributors|nobody has contributed/i);
  });

  it("frames an answered early empty record without calling the product dead", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [],
    });

    expect(html).toContain(
      "Visible named posts can still sit outside this identity-backed record",
    );
    expect(html).not.toContain("First public names land here");
    expect(html).not.toMatch(/no contributors|nobody has contributed/i);
  });

  it("marks a thin record plainly while preserving its real rows", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [
        {
          rank: 1,
          handle: "sam",
          total: 1,
          prices: 1,
          reviews: 0,
          recommendations: 0,
        },
      ],
    });

    expect(html).toContain("Early record");
    expect(html).not.toContain("Every visible contribution counts");
    expect(html).toContain("@sam");
    expect(html).toContain("<strong>1</strong>");
    expect(html).toContain("<span>contribution</span>");
  });
});
