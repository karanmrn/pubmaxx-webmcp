import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normaliseUkPlaceQuery,
  parseUkPlaceIndex,
  searchUkPlaces,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

const place = (row: Omit<UkPlace, "search">): UkPlace => ({
  ...row,
  search: normaliseUkPlaceQuery(row.name),
});

const PLACES: UkPlace[] = [
  place({ name: "Sheffield", lat: 53.381, lng: -1.47, kind: "city", context: "S" }),
  place({ name: "Kelham Island", lat: 53.383, lng: -1.472, kind: "suburb", context: "S" }),
  place({ name: "Bathford", lat: 51.4, lng: -2.3, kind: "village", context: "BA" }),
  place({ name: "Newton", lat: 52.1, lng: -1.1, kind: "village", context: "CV" }),
  place({ name: "Newton", lat: 56.4, lng: -5.4, kind: "village", context: "PA" }),
];

describe("parseUkPlaceIndex", () => {
  it("parses the shipped OSM-licensed index and includes Sheffield", () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/data/uk_base/places.json"),
        "utf8",
      ),
    );

    expect(raw).toMatchObject({
      source: "OpenStreetMap via Overpass API",
      license: "ODbL 1.0",
    });
    expect(parseUkPlaceIndex(raw)).toContainEqual(
      expect.objectContaining({
        name: "Sheffield",
        kind: "city",
      }),
    );
  });

  it("keeps valid UK navigation targets and drops malformed rows", () => {
    expect(
      parseUkPlaceIndex({
        places: [
          ["Sheffield", 53.381, -1.47, "city", "S"],
          ["Outside", 48, -1, "city", "XX"],
          ["Bad coordinate", "53.3", -1.4, "city", "S"],
          ["", 53.3, -1.4, "city", "S"],
          ["Bad kind", 53.3, -1.4, "county", "S"],
          ["<different>", 54.96, -1.6, "place", "NE"],
          ["Hythe;West Hythe", 51.07, 1.08, "town", "CT"],
          ["- broken", 53.3, -1.4, "town", "S"],
          ["retail", 52.1260312, 0.0290461, "city", "CB"],
          ["Unknown", 53.3, -1.4, "town", "S"],
        ],
      }),
    ).toEqual([PLACES[0]]);
  });

  it("carries a precomputed search key so a keystroke never re-normalises 7.5k rows", () => {
    expect(
      parseUkPlaceIndex({ places: [["Ynys Môn", 53.28, -4.33, "place", "LL"]] }),
    ).toEqual([
      {
        name: "Ynys Môn",
        lat: 53.28,
        lng: -4.33,
        kind: "place",
        context: "LL",
        search: "ynys mon",
      },
    ]);
  });

  it("refuses OSM tag noise the chooser would otherwise offer as a town", () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/data/uk_base/places.json"),
        "utf8",
      ),
    );
    const shipped = parseUkPlaceIndex(raw);

    expect(shipped.length).toBeGreaterThan(1_000);
    expect(
      shipped.filter((entry) => /[;<>]/.test(entry.name) || !/^[\p{L}\p{N}]/u.test(entry.name)),
    ).toEqual([]);
    expect(shipped.filter((entry) => entry.search === "retail")).toEqual([]);
    expect(shipped.filter((entry) => /^\p{Ll}/u.test(entry.name))).toEqual([]);
    expect(shipped.map((entry) => entry.name)).toContain("Blantyre");
  });

  it("fails soft when the payload shape is unavailable", () => {
    expect(parseUkPlaceIndex(null)).toEqual([]);
    expect(parseUkPlaceIndex({ places: "missing" })).toEqual([]);
  });
});

describe("searchUkPlaces", () => {
  it("ranks exact matches before prefixes and substrings", () => {
    const results = searchUkPlaces("Sheffield", [
      ...PLACES,
      place({ name: "Sheffield Park", lat: 50.99, lng: 0.01, kind: "village", context: "TN" }),
      place({ name: "Upper Sheffield", lat: 51.2, lng: -1.5, kind: "village", context: "RG" }),
    ]);

    expect(results.map((place) => place.name)).toEqual([
      "Sheffield",
      "Sheffield Park",
      "Upper Sheffield",
    ]);
  });

  it("removes place rows owned by matching curated city cards", () => {
    expect(searchUkPlaces("bath", PLACES, ["Bath"])).toEqual([PLACES[2]]);
    expect(
      searchUkPlaces(
        "bath",
        [...PLACES, place({ name: "Bath", lat: 51.38, lng: -2.36, kind: "city", context: "BA" })],
        ["Bath"],
      ).map((place) => place.name),
    ).toEqual(["Bathford"]);
  });

  it("matches case and accents without inventing a result for short input", () => {
    const places = [
      ...PLACES,
      place({ name: "Ynys Môn", lat: 53.28, lng: -4.33, kind: "place", context: "LL" }),
    ];

    expect(searchUkPlaces("ynys mon", places).map((place) => place.name)).toEqual(["Ynys Môn"]);
    expect(searchUkPlaces("s", places)).toEqual([]);
  });

  it("keeps same-named places separate for honest navigation", () => {
    expect(searchUkPlaces("Newton", PLACES)).toEqual([PLACES[3], PLACES[4]]);
  });
});
