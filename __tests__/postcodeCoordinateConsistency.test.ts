import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { venueBookingAction } from "@/lib/venueExternalActions";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const appRows = JSON.parse(
  readFileSync(
    process.env.POSTCODE_APP_DATASET_PATH ??
      join(process.cwd(), "public/data/pint_prices_app_dataset.json"),
    "utf8",
  ),
) as VenuePrice[];

describe("postcode-coordinate consistency", () => {
  it("does not ship the Lincoln Arms row that conflates Enfield with King's Cross", () => {
    const contradictoryRow = appRows.find(
      (row) =>
        row.pub_name === "The Lincoln Arms" &&
        row.address === "EN1 1QT" &&
        row.latitude === 51.5332 &&
        row.longitude === -0.1222,
    );

    expect(contradictoryRow).toBeUndefined();
  });

  it("cannot build an EN1 1QT booking query for the Lincoln Arms", () => {
    const bookingQueries = groupVenuePrices(appRows)
      .filter((venue) => venue.name === "The Lincoln Arms")
      .map((venue) => venueBookingAction(venue))
      .filter((booking) => booking.tier === "search")
      .map((booking) => new URL(booking.href).searchParams.get("query"));

    expect(bookingQueries).not.toEqual(
      expect.arrayContaining([expect.stringContaining("EN1 1QT")]),
    );
  });
});
