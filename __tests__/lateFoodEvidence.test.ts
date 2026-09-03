import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The dependency-free validator is shared with the Node data gate.
// prettier-ignore
import { EXPECTED_NIGHT_AREA_SLUGS, validateLateFoodEvidence } from "@/scripts/lib/validateLateFoodEvidence.mjs";

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "public/data/late_food_evidence.json"),
    "utf8",
  ),
);

const LOCALITY_NAMES: string[] = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "public/data/london_localities.json"),
    "utf8",
  ),
).localities.map((locality: { name: string }) => locality.name);

const validate = (snapshot: unknown): string[] =>
  validateLateFoodEvidence(snapshot, LOCALITY_NAMES);

describe("late-food evidence snapshot", () => {
  it("covers all 20 canonical Night Areas and passes provenance validation", () => {
    expect(Object.keys(fixture.areas).sort()).toEqual(
      [...EXPECTED_NIGHT_AREA_SLUGS].sort(),
    );
    expect(EXPECTED_NIGHT_AREA_SLUGS).toHaveLength(20);
    expect(validate(fixture)).toEqual([]);
  });

  it("has at least one expiring, anchor-priced first-party option for every Night Area", () => {
    const areas = Object.values(fixture.areas) as Array<{
      status: string;
      options: Array<{
        anchor: {
          label: string;
          price: number;
          sourceUrl: string;
          observedAt: string;
        };
        source: { sourceUrl: string; expiresAt: string };
      }>;
    }>;
    expect(
      areas.every(
        (area) => area.status === "partial" && area.options.length >= 1,
      ),
    ).toBe(true);
    expect(areas.flatMap((area) => area.options)).toHaveLength(20);
    expect(
      areas
        .flatMap((area) => area.options)
        .every(
          (option) =>
            option.source.sourceUrl.startsWith("https://") &&
            Date.parse(option.source.expiresAt) >
              Date.parse(fixture.generatedAt) &&
            option.anchor.label.length > 2 &&
            option.anchor.price > 0 &&
            option.anchor.sourceUrl.startsWith("https://") &&
            Number.isFinite(Date.parse(option.anchor.observedAt)),
        ),
    ).toBe(true);
  });

  it("rejects an option whose published anchor loses provenance", () => {
    const invalid = structuredClone(fixture);
    delete invalid.areas["piccadilly-soho"].options[0].anchor.sourceUrl;
    expect(validate(invalid).join(" ")).toMatch(
      /sourced anchor/i,
    );
  });

  it("rejects an anchor document published for a different branch", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.richmond.options[0].anchor.sourceUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/02/FM-MENU-L0226NC-WATERLOO-V2.pdf";
    expect(validate(invalid).join(" ")).toMatch(/names waterloo/i);
  });

  it("rejects an opaque PDF without branch-to-document proof", () => {
    const invalid = structuredClone(fixture);
    const option = invalid.areas.richmond.options[0];
    option.anchor.sourceUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/06/opaque-menu.pdf";
    delete option.source.anchorDocumentLink;
    expect(validate(invalid).join(" ")).toMatch(
      /PDF anchor requires an explicit operator-page link/i,
    );
  });

  it("rejects document proof that does not match the anchor", () => {
    const wrongDocument = structuredClone(fixture);
    wrongDocument.areas.richmond.options[0].source.anchorDocumentLink.documentUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/06/other.pdf";
    expect(validate(wrongDocument).join(" ")).toMatch(
      /documentUrl must match the anchor source/i,
    );
  });

  it("rejects document proof outside the option source chain", () => {
    const unrelatedPage = structuredClone(fixture);
    unrelatedPage.areas.richmond.options[0].source.anchorDocumentLink.pageUrl =
      "https://www.francomanca.co.uk/menu/";
    expect(validate(unrelatedPage).join(" ")).toMatch(
      /pageUrl must be recorded in the option provenance/i,
    );
  });

  it("rejects document proof from a different operator", () => {
    const wrongOperator = structuredClone(fixture);
    const source = wrongOperator.areas.richmond.options[0].source;
    source.anchorDocumentLink.pageUrl =
      "https://www.honestburgers.co.uk/menus/smash-and-grab-menu/";
    source.supportingUrls = [source.anchorDocumentLink.pageUrl];
    expect(validate(wrongOperator).join(" ")).toMatch(
      /page and document must share an operator host/i,
    );
  });

  it("records each Franco Manca branch page that links its exact menu PDF", () => {
    const expected = {
      victoria: {
        pageUrl:
          "https://www.francomanca.co.uk/restaurants/victoria-nova/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526P.pdf",
        price: 13.95,
      },
      "canary-wharf": {
        pageUrl:
          "https://www.francomanca.co.uk/restaurants/canary-wharf/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526P.pdf",
        price: 13.95,
      },
      islington: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/islington/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      balham: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/balham/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      richmond: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/richmond/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      putney: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/putney/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
    } as const;

    for (const [area, proof] of Object.entries(expected)) {
      const option = fixture.areas[area].options[0];
      expect(option.source.sourceUrl).toBe(proof.pageUrl);
      expect(option.source.anchorDocumentLink).toEqual({
        pageUrl: proof.pageUrl,
        documentUrl: proof.documentUrl,
      });
      expect(option.anchor).toMatchObject({
        sourceUrl: proof.documentUrl,
        price: proof.price,
      });
    }
  });

  it("accepts a chain-wide anchor document that names no branch", () => {
    expect(
      fixture.areas.clapham.options[0].anchor.sourceUrl,
    ).toBe("https://www.honestburgers.co.uk/menus/smash-and-grab-menu/");
    expect(validate(fixture)).toEqual([]);
  });

  it("refuses to run the coverage check without a gazetteer", () => {
    expect(validateLateFoodEvidence(fixture, []).join(" ")).toMatch(
      /gazetteer is required/i,
    );
  });

  it("rejects competitor or review-aggregator provenance", () => {
    const invalid = structuredClone(fixture);
    invalid.areas["piccadilly-soho"].options[0].source.sourceUrl =
      "https://www.tripadvisor.co.uk/example";
    expect(validate(invalid).join(" ")).toMatch(
      /official-operator provenance/i,
    );
  });

  it("rejects non-operator supporting evidence", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.barnes.options[0].source.supportingUrls = [
      "https://maps.example.com/barnes",
    ];
    expect(validate(invalid).join(" ")).toMatch(
      /supportingUrls/i,
    );
  });

  it("requires explicit hours, coordinates and ordered evidence dates", () => {
    const invalid = structuredClone(fixture);
    const option = invalid.areas["piccadilly-soho"].options[0];
    option.serviceHoursText = "";
    delete option.weeklyHours.monday;
    option.coordinates.method = "nearest_guess";
    option.source.expiresAt = option.source.observedAt;
    const errors = validate(invalid).join(" ");
    expect(errors).toMatch(/serviceHoursText/i);
    expect(errors).toMatch(/weeklyHours/i);
    expect(errors).toMatch(/coordinates/i);
    expect(errors).toMatch(/dates are out of order/i);
  });
});
