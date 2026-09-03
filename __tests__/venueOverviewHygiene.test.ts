import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("venue Overview: FSA hygiene placement", () => {
  const overview = readFileSync(
    join(ROOT, "components/map/inspector/VenueOverviewTab.tsx"),
    "utf8",
  );

  it("renders VenueHygiene above the practical-info Disclosure", () => {
    // A matched FSA rating is above-fold Overview content. Burying it inside
    // "Details and practical info" hid it behind a closed disclosure even when
    // the component already fails soft to null for unmatched pubs.
    const hygiene = overview.indexOf("<VenueHygiene");
    const disclosureSummary = overview.indexOf(
      'summary="Details and practical info"',
    );
    expect(hygiene, "VenueOverviewTab must render VenueHygiene").toBeGreaterThan(
      -1,
    );
    expect(
      disclosureSummary,
      "VenueOverviewTab must keep the practical-info Disclosure",
    ).toBeGreaterThan(-1);
    expect(hygiene).toBeLessThan(disclosureSummary);

    const disclosureOpen = overview.lastIndexOf("<Disclosure", disclosureSummary);
    const disclosureClose = overview.indexOf("</Disclosure>", disclosureSummary);
    expect(disclosureOpen).toBeGreaterThan(-1);
    expect(disclosureClose).toBeGreaterThan(disclosureOpen);

    const disclosureBody = overview.slice(disclosureOpen, disclosureClose);
    expect(disclosureBody).not.toContain("<VenueHygiene");
    expect(disclosureBody).toContain("<VenueGettingThere");
  });
});
