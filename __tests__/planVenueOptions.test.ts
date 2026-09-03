import { describe, expect, it } from "vitest";

import { planVenueOptions } from "@/lib/planVenueOptions";
import { VENUE_KINDS } from "@/lib/venues";

describe("planVenueOptions", () => {
  it("reads revisioned slim payloads", () => {
    expect(
      planVenueOptions({
        revision: "deploy-1",
        rows: [{ id: "pub", name: "Wrapped Arms", kind: "pub" }],
      }),
    ).toEqual([{ id: "pub", name: "Wrapped Arms" }]);
  });

  it("keeps legacy and explicit pubs while excluding other venue kinds", () => {
    expect(
      planVenueOptions([
        { id: "legacy", name: "Legacy Arms", address: "1 High Street" },
        { id: "pub", name: "Explicit Pub", kind: "pub" },
        { id: "bar", name: "Cocktail Bar", kind: "bar" },
        { id: "food", name: "Doner Shop", kind: "food" },
      ]),
    ).toEqual([
      { id: "legacy", name: "Legacy Arms", address: "1 High Street" },
      { id: "pub", name: "Explicit Pub" },
    ]);
  });

  it("drops malformed rows and unknown kinds", () => {
    expect(
      planVenueOptions([
        null,
        { id: "", name: "Missing id" },
        { id: "missing-name" },
        { id: "future", name: "Future Venue", kind: "cinema" },
      ]),
    ).toEqual([]);
  });

  it("drops every kind the widened vocabulary added, without a list of its own", () => {
    expect(
      planVenueOptions(
        VENUE_KINDS.filter((kind) => kind !== "pub").map((kind) => ({
          id: kind,
          name: `A ${kind}`,
          kind,
        })),
      ),
    ).toEqual([]);
    expect(planVenueOptions([{ id: "cafe", name: "Desk & Bean", kind: "cafe" }])).toEqual([]);
  });
});
