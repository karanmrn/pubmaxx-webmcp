import { afterEach, describe, expect, it } from "vitest";

import {
  __setUkNationalPubSearchIndexForTests,
  searchUkNationalPubs,
} from "@/lib/ukNationalPubSearch.server";

afterEach(() => {
  __setUkNationalPubSearchIndexForTests(null);
});

describe("searchUkNationalPubs", () => {
  it("ranks an exact name ahead of a substring", () => {
    __setUkNationalPubSearchIndexForTests({
      pubs: [
        ["n1", "The Crown", "Hackney", 51.54, -0.05],
        ["n2", "Crown and Anchor", "Poplar", 51.51, -0.02],
        ["w9", "Philharmonic Dining Rooms", "Liverpool", 53.4, -2.97],
      ],
    });
    const { status, hits } = searchUkNationalPubs("The Crown", 5);
    expect(status).toBe("ready");
    expect(hits[0]?.name).toBe("The Crown");
    expect(hits[0]?.id).toBe("venue-uk-n1");
  });

  it("finds a distant notable pub by name", () => {
    __setUkNationalPubSearchIndexForTests({
      pubs: [
        ["w9", "Philharmonic Dining Rooms", "Liverpool", 53.4, -2.97],
        ["n1", "The Crown", "Hackney", 51.54, -0.05],
      ],
    });
    const { hits } = searchUkNationalPubs("Philharmonic", 5);
    expect(hits.some((hit) => hit.name.includes("Philharmonic"))).toBe(true);
  });

  it("returns no hits for a tiny query", () => {
    __setUkNationalPubSearchIndexForTests({
      pubs: [["n1", "The Crown", "Hackney", 51.54, -0.05]],
    });
    expect(searchUkNationalPubs("T", 5).hits).toEqual([]);
  });
});
