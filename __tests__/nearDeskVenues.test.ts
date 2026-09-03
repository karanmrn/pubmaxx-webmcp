import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESK_PACK_PATH,
  DESK_PACK_VERSION,
  parseDeskPack,
  type DeskPackJson,
} from "@/lib/nearDeskVenues";
import { isDeskEligible } from "@/lib/nearDesk";

function row(
  extras: Partial<{
    ref: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    kind: string;
    wifi: string;
    laptop: string;
    hours: string;
  }> = {},
): unknown[] {
  return [
    extras.ref ?? "n1",
    extras.name ?? "Desk Bean",
    extras.address ?? "Soho",
    extras.lat ?? 51.5136,
    extras.lng ?? -0.1365,
    extras.kind ?? "cafe",
    extras.wifi ?? "",
    extras.laptop ?? "",
    extras.hours ?? "",
  ];
}

function pack(venues: unknown[], extras: Partial<DeskPackJson> = {}): unknown {
  return {
    version: DESK_PACK_VERSION,
    source: "osm",
    observedAt: "2026-08-16T04:01:27.583Z",
    venues,
    ...extras,
  };
}

describe("parseDeskPack", () => {
  it("maps a well-formed row onto a desk point with honest amenities", () => {
    const parsed = parseDeskPack(pack([
      row({ wifi: "wlan", laptop: "yes", hours: "Mo-Fr 08:00-17:00" }),
    ]));
    expect(parsed.observedAt).toBe("2026-08-16T04:01:27.583Z");
    expect(parsed.source).toBe("osm");
    expect(parsed.venues).toHaveLength(1);
    const venue = parsed.venues[0];
    expect(venue?.id).toBe("venue-osm-n1");
    expect(venue?.wifi).toBe("yes");
    expect(venue?.laptop).toBe("allowed");
    expect(venue?.hoursRaw).toBe("Mo-Fr 08:00-17:00");
    expect(venue?.openingHours?.[1]?.[0]).toEqual({ opens: "08:00", closes: "17:00" });
  });

  it("drops malformed rows rather than poisoning the pack", () => {
    const parsed = parseDeskPack(pack([
      row(),
      ["n2"],
      row({ name: "" }),
      row({ lat: Number.NaN }),
      row({ kind: "spaceship" }),
      "not-a-row",
    ]));
    expect(parsed.venues.map((venue) => venue.id)).toEqual(["venue-osm-n1"]);
  });

  it("admits a wifi pub and refuses a pub with no wifi tag", () => {
    const parsed = parseDeskPack(pack([
      row({ ref: "n-pub-wifi", kind: "pub", wifi: "yes", name: "Wifi Arms" }),
      row({ ref: "n-pub-dark", kind: "pub", wifi: "", name: "Dark Arms" }),
      row({ ref: "n-cafe", kind: "cafe", wifi: "", name: "Quiet Cafe" }),
    ]));
    expect(parsed.venues.map((venue) => venue.name)).toEqual(["Wifi Arms", "Quiet Cafe"]);
    expect(parsed.venues.every((venue) => isDeskEligible(venue))).toBe(true);
  });

  it("treats a missing or unreadable covering stamp as undated", () => {
    expect(parseDeskPack(pack([row()], { observedAt: null })).observedAt).toBeNull();
    expect(parseDeskPack(pack([row()], { observedAt: "soon" })).observedAt).toBeNull();
    expect(parseDeskPack({ venues: [row()] }).observedAt).toBeNull();
    expect(parseDeskPack(null).venues).toEqual([]);
  });
});

describe("shipped London desk pack", () => {
  it("parses the generated desks.json with an OSM covering stamp", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "public", DESK_PACK_PATH.replace(/^\//, "")), "utf8"),
    ) as unknown;
    const parsed = parseDeskPack(raw);
    expect(parsed.venues.length).toBeGreaterThan(1000);
    expect(Number.isFinite(Date.parse(parsed.observedAt ?? ""))).toBe(true);
    expect(parsed.source).toBe("osm");
    expect(parsed.venues.every((venue) => isDeskEligible(venue))).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "cafe")).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "library")).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "coworking")).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "hotel_lounge")).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "pub" && venue.wifi === "yes")).toBe(true);
    expect(parsed.venues.some((venue) => venue.kind === "pub" && venue.wifi !== "yes")).toBe(false);
  });
});
