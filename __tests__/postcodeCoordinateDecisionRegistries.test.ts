import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  matchesStrictBuildQuarantineIdentity,
  matchesTolerantPublishedQuarantineLeak,
  publishedQuarantineLeakValidationErrors,
  validatePostcodeCoordinateQuarantine,
} from "../scripts/lib/postcodeCoordinateConsistency.mjs";
import type { PostcodeCoordinateRow } from "../scripts/lib/postcodeCoordinateConsistency.mjs";

const lincolnRow = {
  app_price_id: "app_price_000339",
  pub_name: "The Lincoln Arms",
  address: "EN1 1QT",
  latitude: 51.5332,
  longitude: -0.1222,
};

const osmPubs = [
  {
    name: "Bush Hill Park",
    postcode: "EN1 1BA",
    lat: 51.6415276,
    lng: -0.0687715,
  },
];

const lincolnQuarantine = {
  appPriceId: "app_price_000339",
  pubName: "The Lincoln Arms",
  postcode: "EN1 1QT",
  latitude: 51.5332,
  longitude: -0.1222,
  reason:
    "Two real same-named pubs match opposing fields, so price ownership is unresolved.",
};

function validate(rows: PostcodeCoordinateRow[], quarantineRows: unknown[]) {
  return validatePostcodeCoordinateQuarantine({
    rows,
    osmPubs,
    quarantineRegistry: { rows: quarantineRows },
  });
}

describe("postcode-coordinate quarantine registry", () => {
  it("keeps every decision navigable to exact preserved source lines", () => {
    const registry = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "postcode_coordinate_quarantine.json"),
        "utf8",
      ),
    ) as {
      rows: {
        appPriceId: string;
        pubName: string;
        sourceRows: string[];
      }[];
    };

    for (const entry of registry.rows) {
      expect(entry.sourceRows.length, entry.appPriceId).toBeGreaterThan(1);
      expect(
        entry.sourceRows.some((reference) =>
          reference.startsWith("data/pub_locations_map_data.csv:"),
        ),
        entry.appPriceId,
      ).toBe(true);
      expect(
        entry.sourceRows.some(
          (reference) =>
            reference.startsWith(
              "data/all_pint_prices_combined.csv:",
            ) ||
            reference.startsWith(
              "data/borough_embedded_pint_prices.csv:",
            ),
        ),
        entry.appPriceId,
      ).toBe(true);

      for (const reference of entry.sourceRows) {
        const match = reference.match(/^(.+):([1-9]\d*)$/);
        expect(match, reference).not.toBeNull();
        const [, relativePath, lineText] = match!;
        const sourceLine = readFileSync(
          join(process.cwd(), relativePath),
          "utf8",
        ).split(/\r?\n/)[Number(lineText) - 1];
        expect(sourceLine, reference).toContain(entry.pubName);
      }
    }
  });

  it("fails loudly when a published row leaks within measured coordinate tolerance", () => {
    const leakedRow = {
      ...lincolnRow,
      app_price_id: "app_price_reassigned",
      address: "155 Percival Road, Enfield EN1 1QT, UK",
      latitude: 51.53320005,
      longitude: -0.12220005,
    };

    expect(
      publishedQuarantineLeakValidationErrors({
        publishedRows: [leakedRow],
        quarantineRows: [lincolnQuarantine],
      }),
    ).toEqual([
      "invalid postcode-coordinate quarantine: app_price_000339 (The Lincoln Arms) reached the product dataset",
    ]);
    expect(
      matchesStrictBuildQuarantineIdentity(leakedRow, lincolnQuarantine),
    ).toBe(false);
  });

  it("matches the strict build identity only without coordinate drift", () => {
    expect(
      matchesStrictBuildQuarantineIdentity(
        lincolnRow,
        lincolnQuarantine,
      ),
    ).toBe(true);
  });

  it("rejects a published identity beyond the measured leak tolerance", () => {
    expect(
      matchesTolerantPublishedQuarantineLeak(
        {
          ...lincolnRow,
          address: "155 Percival Road, Enfield EN1 1QT, UK",
          latitude: 51.53320011,
        },
        lincolnQuarantine,
      ),
    ).toBe(false);
  });

  it("applies one exact, reasoned row decision", () => {
    const result = validate([lincolnRow], [lincolnQuarantine]);

    expect(result.invalidQuarantines).toEqual([]);
    expect(result.appliedQuarantines).toHaveLength(1);
    expect(result.unquarantinedContradictions).toEqual([]);
  });

  it("rejects any quarantine coordinate change even within leak-detection tolerance", () => {
    const result = validate(
      [lincolnRow],
      [
        {
          ...lincolnQuarantine,
          latitude: lincolnQuarantine.latitude + 0.00000005,
        },
      ],
    );

    expect(result.invalidQuarantines.join("\n")).toContain(
      "identity fields do not match app_price_000339",
    );
  });

  it.each([
    {
      label: "partial",
      rows: [{ ...lincolnQuarantine, longitude: undefined }],
      expected: "latitude and longitude must be finite numbers",
    },
    {
      label: "duplicate",
      rows: [lincolnQuarantine, lincolnQuarantine],
      expected: "duplicate appPriceId app_price_000339",
    },
    {
      label: "reasonless",
      rows: [{ ...lincolnQuarantine, reason: "" }],
      expected: "reason must contain at least 20 characters",
    },
    {
      label: "stale",
      rows: [
        { ...lincolnQuarantine, appPriceId: "app_price_999999" },
      ],
      expected: "app_price_999999 is not in the pre-publication dataset",
    },
    {
      label: "identity mismatch",
      rows: [{ ...lincolnQuarantine, pubName: "Another Lincoln Arms" }],
      expected: "identity fields do not match app_price_000339",
    },
  ])("rejects a $label entry", ({ rows, expected }) => {
    const result = validate([lincolnRow], rows);

    expect(result.invalidQuarantines.join("\n")).toContain(expected);
  });

  it("rejects a no-longer-contradictory entry", () => {
    const consistentRow = {
      ...lincolnRow,
      latitude: 51.6415276,
      longitude: -0.0687715,
    };
    const result = validate(
      [consistentRow],
      [
        {
          ...lincolnQuarantine,
          latitude: consistentRow.latitude,
          longitude: consistentRow.longitude,
        },
      ],
    );

    expect(result.invalidQuarantines.join("\n")).toContain(
      "app_price_000339 is not a postcode-coordinate contradiction",
    );
  });

  it("rejects grouped or ambiguous app price ids", () => {
    const result = validate([lincolnRow], [
      {
        ...lincolnQuarantine,
        appPriceId: undefined,
        appPriceIds: ["app_price_000339", "app_price_000340"],
      },
    ]);

    expect(result.invalidQuarantines.join("\n")).toContain(
      "appPriceId must be non-empty",
    );
  });
});
