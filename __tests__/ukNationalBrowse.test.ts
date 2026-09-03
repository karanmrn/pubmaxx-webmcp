import { describe, expect, it } from "vitest";

import {
  UK_CHOOSE_CITY_SEARCH_HREF,
  UK_NATIONAL_BROWSE_COPY,
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
  UK_OUTSIDE_CITY_COPY,
  isUkNationalBrowse,
} from "@/lib/ukNationalBrowse";
import { resolveLocateMapDestination } from "@/lib/locateMapDestination";
import { nearestUkPlace } from "@/lib/nearestUkPlace";
import type { UkPlace } from "@/lib/ukPlaceSearch";
import { CITIES } from "@/lib/cities";

const places: UkPlace[] = [
  {
    name: "Norwich",
    lat: 52.63,
    lng: 1.3,
    kind: "city",
    context: "",
    search: "norwich",
  },
  {
    name: "Exeter",
    lat: 50.72,
    lng: -3.53,
    kind: "city",
    context: "",
    search: "exeter",
  },
];

describe("nearestUkPlace", () => {
  it("returns the closest place within the cap", () => {
    const hit = nearestUkPlace(52.65, 1.28, places);
    expect(hit?.name).toBe("Norwich");
  });

  it("returns null when nothing is near enough", () => {
    expect(nearestUkPlace(50, 0, places, 5)).toBeNull();
  });
});

describe("resolveLocateMapDestination", () => {
  it("prefers a curated city when inside the near-city window", () => {
    const [lng, lat] = CITIES.manchester.mapView.center;
    const dest = resolveLocateMapDestination(lat, lng, places);
    expect(dest).toMatchObject({
      kind: "city",
      cityId: "manchester",
      label: "Manchester",
    });
  });

  it("opens an uncovered place when outside every curated city", () => {
    // Norwich is >80km from every enabled city centre, so locate must not
    // fall through to a priced pack.
    const dest = resolveLocateMapDestination(52.65, 1.28, places);
    expect(dest.kind).toBe("place");
    if (dest.kind !== "place") return;
    expect(dest.arrival.name).toBe("Norwich");
    expect(dest.arrival.lat).toBe(52.65);
    expect(dest.arrival.lng).toBe(1.28);
    expect(dest.href).toContain("place=Norwich");
    expect(dest.href).toContain("lat=52.65");
  });

  it("returns none when neither city nor place is near", () => {
    expect(resolveLocateMapDestination(0, -30, places)).toEqual({
      kind: "none",
    });
  });
});

describe("uk national browse", () => {
  it("detects the national intent param", () => {
    expect(isUkNationalBrowse("uk=1")).toBe(true);
    expect(isUkNationalBrowse("?uk=1&sel=x")).toBe(true);
    expect(isUkNationalBrowse("place=Leeds")).toBe(false);
    expect(UK_NATIONAL_MAP_HREF).toBe("/map?uk=1");
    expect(UK_CHOOSE_CITY_SEARCH_HREF).toBe("/choose-city?focus=search");
  });

  it("keeps national entry copy free of banned voice tells", () => {
    const blob = [
      UK_NATIONAL_BROWSE_COPY.title,
      UK_NATIONAL_BROWSE_COPY.body,
      UK_OUTSIDE_CITY_COPY.title,
      UK_OUTSIDE_CITY_COPY.body,
      UK_NATIONAL_ENTRY_LABEL,
    ].join(" ");
    expect(blob).not.toMatch(/!/);
    expect(blob).not.toMatch(/\u2014/);
    expect(blob).not.toMatch(/ curated /i);
    expect(blob).not.toMatch(/discover|seamless|elevate/i);
  });
});
