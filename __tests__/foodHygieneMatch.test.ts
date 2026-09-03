import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractPostcode,
  fetchEstablishmentsByPostcode,
  matchEstablishment,
  nameSimilarity,
  normaliseName,
  postcodesMatch,
  resetHygieneCache,
  resolveHygieneRating,
} from "@/lib/foodHygiene";

const PUB = {
  FHRSID: 1026539,
  BusinessName: "The Arnos Arms",
  BusinessType: "Pub/bar/nightclub",
  PostCode: "N11 1AN",
  RatingValue: "5",
  RatingDate: "2025-06-05T00:00:00",
  SchemeType: "FHRS",
  LocalAuthorityName: "Enfield",
};
const CAFE = {
  FHRSID: 1714531,
  BusinessName: "Costa Coffee",
  BusinessType: "Restaurant/Cafe/Canteen",
  PostCode: "N11 1AN",
  RatingValue: "4",
  RatingDate: "2025-07-11T00:00:00",
  SchemeType: "FHRS",
  LocalAuthorityName: "Enfield",
};

describe("extractPostcode", () => {
  it("pulls a normalised postcode out of a free-text address", () => {
    expect(extractPostcode("338 Bowes Road, Arnos Grove, London, N11 1AN")).toBe("N11 1AN");
  });
  it("tolerates a missing space", () => {
    expect(extractPostcode("The Ship, London SW181TS")).toBe("SW18 1TS");
  });
  it("returns null when there is no postcode", () => {
    expect(extractPostcode("Somewhere in London")).toBeNull();
    expect(extractPostcode(null)).toBeNull();
  });
  it("matches postcodes ignoring spacing and case", () => {
    expect(postcodesMatch("n111an", "N11 1AN")).toBe(true);
    expect(postcodesMatch("N11 1AN", "N11 2AB")).toBe(false);
  });
});

describe("normaliseName / nameSimilarity", () => {
  it("drops noise words and punctuation", () => {
    expect(normaliseName("The Ship Inn (Ltd.)")).toBe("ship inn");
    expect(normaliseName("Rose & Crown")).toBe("rose crown");
  });
  it("scores an identical normalised name as 1", () => {
    expect(nameSimilarity("The Ship", "Ship")).toBe(1);
  });
  it("scores a near-name highly and an unrelated name low", () => {
    expect(nameSimilarity("The Arnos Arms", "Arnos Arms")).toBeGreaterThan(0.7);
    expect(nameSimilarity("The Arnos Arms", "Costa Coffee")).toBeLessThan(0.3);
  });
});

describe("matchEstablishment", () => {
  it("matches the right pub in a shared postcode", () => {
    const match = matchEstablishment("The Arnos Arms", [CAFE, PUB]);
    expect(match?.fhrsid).toBe(1026539);
    expect(match?.ratingValue).toBe(5);
    expect(match?.businessName).toBe("The Arnos Arms");
    expect(match?.localAuthority).toBe("Enfield");
  });
  it("returns null when no candidate clears the fuzzy threshold", () => {
    expect(matchEstablishment("The Kings Head", [CAFE, PUB])).toBeNull();
  });
  it("skips non-FHRS scheme rows (Scotland FHIS)", () => {
    const scottish = { ...PUB, SchemeType: "FHIS", RatingValue: "Pass" };
    expect(matchEstablishment("The Arnos Arms", [scottish])).toBeNull();
  });
  it("skips non-numeric statuses (AwaitingInspection / Exempt)", () => {
    const awaiting = { ...PUB, RatingValue: "AwaitingInspection" };
    expect(matchEstablishment("The Arnos Arms", [awaiting])).toBeNull();
  });
  it("prefers a pub over a similarly named cafe on a near-tie", () => {
    const cafeVariant = { ...CAFE, BusinessName: "Arnos Arms Cafe" };
    const match = matchEstablishment("Arnos Arms", [cafeVariant, PUB]);
    expect(match?.fhrsid).toBe(PUB.FHRSID);
  });
});

describe("resolveHygieneRating", () => {
  beforeEach(() => resetHygieneCache());
  afterEach(() => vi.restoreAllMocks());

  function jsonResponse(establishments: unknown[]): Response {
    return new Response(JSON.stringify({ establishments }), { status: 200 });
  }

  it("resolves a rating and sends the x-api-version header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([CAFE, PUB]));
    const rating = await resolveHygieneRating(
      "The Arnos Arms",
      "338 Bowes Road, London, N11 1AN",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(rating?.ratingValue).toBe(5);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("N11%201AN");
    expect(init.headers).toMatchObject({ "x-api-version": "2" });
  });

  it("caches by (postcode, name) so a re-open does not re-fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PUB]));
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    await resolveHygieneRating("The Arnos Arms", "N11 1AN", opts);
    await resolveHygieneRating("The Arnos Arms", "N11 1AN", opts);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null (no badge) for an unmatched pub", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([CAFE]));
    const rating = await resolveHygieneRating("The Kings Head", "N11 1AN", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rating).toBeNull();
  });

  it("returns null with no postcode in the address", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PUB]));
    const rating = await resolveHygieneRating("The Arnos Arms", "no postcode here", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rating).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft to null on an upstream error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const rating = await resolveHygieneRating("The Arnos Arms", "N11 1AN", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rating).toBeNull();
  });
});

describe("fetchEstablishmentsByPostcode", () => {
  it("throws on a non-ok upstream so resolve can fail soft", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    await expect(
      fetchEstablishmentsByPostcode("N11 1AN", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
