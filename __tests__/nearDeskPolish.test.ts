import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { evaluateOpenState } from "@/lib/busyness";
import {
  DESK_CHAINS,
  deskAmenityLines,
  deskChainKey,
  deskCollapsedChainsAttributes,
  deskHoursCaption,
  parseOsmOpeningHours,
  rankDeskNearMe,
  type DeskPoint,
} from "@/lib/nearDesk";
import type { VenueKind } from "@/lib/venues";

const here = { lat: 51.5136, lng: -0.1365 };
const LONDON = "Europe/London";

function desk(
  id: string,
  dLat: number,
  extras: Partial<DeskPoint> = {},
): DeskPoint {
  return {
    id,
    name: extras.name ?? id,
    lat: here.lat + dLat,
    lng: here.lng,
    kind: (extras.kind ?? "cafe") as VenueKind,
    wifi: extras.wifi ?? "unknown",
    laptop: extras.laptop ?? "unknown",
    openingHours: extras.openingHours ?? null,
    hoursRaw: extras.hoursRaw ?? null,
    address: extras.address ?? "",
  };
}

describe("parseOsmOpeningHours later-rule override", () => {
  it("lets a later same-day rule replace the earlier window, not union it", () => {
    const hours = parseOsmOpeningHours("Mo-Su 08:00-22:00; Su 10:00-18:00");
    expect(hours?.[0]).toEqual([{ opens: "10:00", closes: "18:00" }]);
    expect(hours?.[1]).toEqual([{ opens: "08:00", closes: "22:00" }]);
    expect(evaluateOpenState({
      now: new Date("2026-08-16T08:30:00+01:00"),
      timeZone: LONDON,
      openingHours: hours ?? undefined,
    })).toBe(false);
    expect(evaluateOpenState({
      now: new Date("2026-08-16T11:00:00+01:00"),
      timeZone: LONDON,
      openingHours: hours ?? undefined,
    })).toBe(true);
  });

  it("overrides weekday windows from the twenty shipped desk-pack patterns", () => {
    const cases: Array<{ raw: string; day: number; want: { opens: string; closes: string }[] }> = [
      { raw: "Mo-Fr 08:30-15:00; Su-Sa 08:30-16:00", day: 3, want: [{ opens: "08:30", closes: "16:00" }] },
      { raw: "Mo-Fr 09:30-19:00; We off; Sa 09:30-17:00; Su off", day: 3, want: [] },
      { raw: "Mo-Fr 09:30-19:00; We off; Sa 09:30-17:00", day: 3, want: [] },
      { raw: "Tu-Fr 09:00-13:00,14:00-18:00; We off; Sa 10:00-14:00", day: 3, want: [] },
      { raw: "Mo-Su 11:00-23:00; Fr-Sa 11:00-24:00", day: 5, want: [{ opens: "11:00", closes: "24:00" }] },
      { raw: "Mo-Fr 09:30-18:00; We 10:00-19:00; Sa 09:30-16:00", day: 3, want: [{ opens: "10:00", closes: "19:00" }] },
      { raw: "Mo-Sa 07:00-16:00; Tu off; Su 09:00-16:00", day: 2, want: [] },
      {
        raw: "Mo-Su 08:00-24:00; Fr,Sa 00:00-00:30,08:00-24:00",
        day: 5,
        want: [{ opens: "00:00", closes: "00:30" }, { opens: "08:00", closes: "24:00" }],
      },
      { raw: "Mo-Th 09:00-19:00; Tu-We,Fr 09:00-17:00; Sa 09:00-13:00; Su,PH off", day: 3, want: [{ opens: "09:00", closes: "17:00" }] },
      { raw: "Mo-Fr 11:30-15:00,17:00-22:30; Tu off; Th off; Sa,Su 11:30-16:00,17:00-22:30", day: 4, want: [] },
      { raw: "Mo-Su 09:00-17:30; Sa 09:00-17:45; Su 09:30-17:45", day: 0, want: [{ opens: "09:30", closes: "17:45" }] },
      { raw: "Mo-Fr 08:30-17:00; Sa-Su 09:00-17:00; Fr-Sa 18:00-23:00", day: 5, want: [{ opens: "18:00", closes: "23:00" }] },
      { raw: "Mo-Fr 07:30-18:30; Sa 09:00-18:30; Su 10:00-17:30; Mo-Fr 09:00-19:00; Sa 08:00-19:30; Su 08:00-18:30", day: 0, want: [{ opens: "08:00", closes: "18:30" }] },
      { raw: "Mo-Su 10:30-19:30; Mo-Su 12:00-19:00", day: 1, want: [{ opens: "12:00", closes: "19:00" }] },
      { raw: "Mo-Su 12:00-20:00; Sa 11:00-23:00", day: 6, want: [{ opens: "11:00", closes: "23:00" }] },
      { raw: "Mo-Fr 10:00-17:00, Tu 10:00-19:00", day: 2, want: [{ opens: "10:00", closes: "19:00" }] },
      { raw: "Mo-We 07:30-21:00; We-Fr 07:30-22:00; Sa 09:00-22:00; Su 09:00-18:00", day: 3, want: [{ opens: "07:30", closes: "22:00" }] },
      { raw: "Tu-Sa 11:00-17:00; We-Fr 19:00-22:00", day: 3, want: [{ opens: "19:00", closes: "22:00" }] },
      { raw: "Mo-Su 08:00-15:30; Th-Sa 08:00-22:00", day: 4, want: [{ opens: "08:00", closes: "22:00" }] },
      { raw: "Mo-Th 07:00-19:00, Th,Fr 07:00-22:00, Su 08:00-19:00", day: 4, want: [{ opens: "07:00", closes: "22:00" }] },
    ];
    expect(cases).toHaveLength(20);
    for (const row of cases) {
      const hours = parseOsmOpeningHours(row.raw);
      expect(hours, row.raw).not.toBeNull();
      expect(hours?.[row.day], row.raw).toEqual(row.want);
    }
  });

  it("does not rank a Sunday-morning venue as open when Sunday is the later window", () => {
    const hours = parseOsmOpeningHours("Mo-Su 08:00-22:00; Su 10:00-18:00");
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("shut", 0.001, {
        name: "Sunday Late Open",
        wifi: "yes",
        openingHours: hours,
        hoursRaw: "Mo-Su 08:00-22:00; Su 10:00-18:00",
      }),
      desk("open", 0.0012, {
        name: "Open Now",
        wifi: "yes",
        openingHours: parseOsmOpeningHours("Mo-Su 00:00-24:00"),
      }),
    ], { now: new Date("2026-08-16T08:30:00+01:00") });
    expect(answer.cards[0]?.name).toBe("Open Now");
    expect(answer.cards.find((card) => card.name === "Sunday Late Open")?.openNow).toBe(false);
  });
});

describe("deskChainKey", () => {
  it("folds accents, case and punctuation onto one chain key", () => {
    expect(deskChainKey("Caffè Nero")).toBe("caffe nero");
    expect(deskChainKey("Caffe Nero")).toBe("caffe nero");
    expect(deskChainKey("Cafe Nero Express")).toBe("caffe nero");
    expect(deskChainKey("Caffè Nero express")).toBe("caffe nero");
    expect(deskChainKey("Nero Express")).toBe("caffe nero");
  });

  it("strips branch and street suffixes without collapsing independents", () => {
    expect(deskChainKey("Costa Coffee")).toBe("costa");
    expect(deskChainKey("Costa Express")).toBe("costa");
    expect(deskChainKey("Starbucks Coffee")).toBe("starbucks");
    expect(deskChainKey("Starbucks Excel")).toBe("starbucks");
    expect(deskChainKey("GAIL's Bakery")).toBe("gails");
    expect(deskChainKey("Gail's")).toBe("gails");
    expect(deskChainKey("Pret A Manger")).toBe("pret");
    expect(deskChainKey("Pret a manger")).toBe("pret");
    expect(deskChainKey("Black Sheep Coffee")).toBe("black sheep");
    expect(deskChainKey("WeWork")).toBe("wework");
    expect(deskChainKey("Caffè Nero Oxford Street")).toBe("caffe nero");
  });

  it("leaves independent cafes on their own key", () => {
    expect(deskChainKey("Gallo Nero")).toBe("gallo nero");
    expect(deskChainKey("La costa cafe")).toBe("la costa cafe");
    expect(deskChainKey("Abigails Café")).toBe("abigails cafe");
    expect(deskChainKey("Petit Pret")).toBe("petit pret");
    expect(deskChainKey("Pretty Little Cupcakes")).toBe("pretty little cupcakes");
    expect(deskChainKey("Desk and Bean")).toBe("desk and bean");
  });

  it("keeps two independents apart when only a generic token separates them", () => {
    const pairs: Array<[string, string]> = [
      ["Cafe 26", "Café 54"],
      ["Station 26", "Station Cafe"],
      ["Sutton Cafe", "Sutton Green Café"],
      ["The Café", "The Green Cafe"],
      ["Cafe Express", "Cafe Terrace"],
    ];
    for (const [left, right] of pairs) {
      expect(deskChainKey(left), `${left} vs ${right}`).not.toBe(deskChainKey(right));
    }
    expect(deskChainKey("Cafe 26")).toBe("cafe 26");
    expect(deskChainKey("Café 54")).toBe("cafe 54");
  });

  it("collapses every listed chain onto its own key and nothing else", () => {
    expect(DESK_CHAINS.map((chain) => chain.key)).toEqual([
      "caffe nero",
      "pret",
      "costa",
      "starbucks",
      "gails",
      "black sheep",
      "wework",
      "joe and the juice",
      "leon",
      "paul",
      "blank street",
      "grind",
      "ole and steen",
    ]);
    for (const chain of DESK_CHAINS) {
      for (const name of chain.names) {
        expect(deskChainKey(name), name).toBe(chain.key);
        expect(deskChainKey(`${name} Oxford Street`), name).toBe(chain.key);
      }
    }
    expect(deskChainKey("Joe & The Juice")).toBe("joe and the juice");
    expect(deskChainKey("Ole & Steen")).toBe("ole and steen");
  });
});

describe("rankDeskNearMe independents", () => {
  it("shows both independents that a generic-token strip used to merge", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("cafe-26", 0.0004, { name: "Cafe 26", wifi: "yes" }),
      desk("cafe-54", 0.0005, { name: "Café 54", wifi: "yes" }),
      desk("station-26", 0.0006, { name: "Station 26", wifi: "yes" }),
      desk("station-cafe", 0.0007, { name: "Station Cafe", wifi: "yes" }),
      desk("nero-1", 0.0008, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-2", 0.0009, { name: "Caffè Nero Oxford Street", wifi: "yes" }),
    ]);
    expect(answer.cards.map((card) => card.name)).toEqual([
      "Cafe 26",
      "Café 54",
      "Station 26",
      "Station Cafe",
      "Caffè Nero",
    ]);
    expect(answer.collapsedChains).toEqual(["caffe nero"]);
  });
});

describe("rankDeskNearMe chain diversity", () => {
  it("keeps one venue per chain after ranking, and never drops an independent", () => {
    const venues = [
      desk("nero-1", 0.0004, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-2", 0.0005, { name: "Caffè Nero Express", wifi: "yes" }),
      desk("nero-3", 0.0006, { name: "Cafe Nero Express", wifi: "yes" }),
      desk("bean", 0.0007, { name: "Desk and Bean" }),
      desk("costa-1", 0.0008, { name: "Costa Coffee", wifi: "yes" }),
      desk("costa-2", 0.0009, { name: "Costa", wifi: "yes" }),
      desk("notes", 0.001, { name: "Notes" }),
    ];
    const answer = rankDeskNearMe(here.lat, here.lng, venues);
    expect(answer.cards.map((card) => card.name)).toEqual([
      "Caffè Nero",
      "Costa Coffee",
      "Desk and Bean",
      "Notes",
      "Caffè Nero Express",
    ]);
    expect(answer.hero?.name).toBe("Caffè Nero");
    expect(answer.collapsedChains).toEqual(["caffe nero", "costa"]);
  });

  it("fills from the same chain when fewer than five candidates remain", () => {
    const venues = [
      desk("nero-1", 0.0004, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-2", 0.0005, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-3", 0.0006, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-4", 0.0007, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-5", 0.0008, { name: "Caffè Nero", wifi: "yes" }),
      desk("nero-6", 0.0009, { name: "Caffè Nero", wifi: "yes" }),
      desk("bean", 0.001, { name: "Desk and Bean" }),
    ];
    const answer = rankDeskNearMe(here.lat, here.lng, venues);
    expect(answer.cards).toHaveLength(5);
    expect(answer.cards[0]?.name).toBe("Caffè Nero");
    expect(answer.cards.some((card) => card.name === "Desk and Bean")).toBe(true);
    expect(answer.cards.filter((card) => card.name === "Caffè Nero")).toHaveLength(4);
    expect(answer.collapsedChains).toEqual(["caffe nero"]);
  });

  it("does not change the rank keys among distinct independents", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("far-wifi", 0.00855, { name: "Far Wifi", wifi: "yes", laptop: "allowed" }),
      desk("near-untagged", 0.00054, { name: "Near Untagged" }),
    ]);
    expect(answer.cards.map((card) => card.name)).toEqual(["Near Untagged", "Far Wifi"]);
    expect(answer.collapsedChains).toEqual([]);
  });
});

describe("deskHoursCaption", () => {
  const weekdayHours = parseOsmOpeningHours("Mo-Fr 07:00-17:00");
  const everyDay = parseOsmOpeningHours("Mo-Su 08:00-22:00");

  it("names open, later-today, closed and unknown in house voice", () => {
    expect(deskHoursCaption(everyDay, new Date("2026-08-16T15:00:00+01:00"), LONDON)).toBe("Open until 22:00");
    expect(deskHoursCaption(weekdayHours, new Date("2026-08-17T06:00:00+01:00"), LONDON)).toBe("Opens 07:00");
    expect(deskHoursCaption(weekdayHours, new Date("2026-08-17T18:00:00+01:00"), LONDON)).toBe("Closed today");
    expect(deskHoursCaption(weekdayHours, new Date("2026-08-16T12:00:00+01:00"), LONDON)).toBe("Closed today");
    expect(deskHoursCaption(null, new Date("2026-08-16T12:00:00+01:00"), LONDON)).toBe("Hours unknown");
  });

  it("says all day and midnight rather than printing a 24:00 clock", () => {
    const allDay = parseOsmOpeningHours("24/7");
    const lateClose = parseOsmOpeningHours("Mo-Su 22:00-24:00");
    const rollsToMidnight = parseOsmOpeningHours("Mo-Su 08:00-00:00");
    expect(deskHoursCaption(allDay, new Date("2026-08-16T14:00:00+01:00"), LONDON)).toBe("Open all day");
    expect(deskHoursCaption(lateClose, new Date("2026-08-16T22:30:00+01:00"), LONDON)).toBe("Open until midnight");
    expect(deskHoursCaption(rollsToMidnight, new Date("2026-08-16T23:00:00+01:00"), LONDON)).toBe("Open until midnight");
    expect(deskHoursCaption(allDay, new Date("2026-08-16T14:00:00+01:00"), LONDON)).not.toContain("24:00");
  });

  it("reads London when no zone is named, not the machine clock", () => {
    const sundayOnly = parseOsmOpeningHours("Su 12:00-20:00");
    // Saturday 23:30 UTC is Sunday 00:30 in London.
    expect(deskHoursCaption(sundayOnly, new Date("2026-08-15T23:30:00Z"))).toBe("Opens 12:00");
  });

  it("crosses the closing minute and the next morning without hedging", () => {
    expect(deskHoursCaption(everyDay, new Date("2026-08-16T21:59:00+01:00"), LONDON)).toBe("Open until 22:00");
    expect(deskHoursCaption(everyDay, new Date("2026-08-16T22:00:00+01:00"), LONDON)).toBe("Closed today");
    expect(deskHoursCaption(weekdayHours, new Date("2026-08-16T23:30:00+01:00"), LONDON)).toBe("Closed today");
    expect(deskHoursCaption(weekdayHours, new Date("2026-08-17T00:15:00+01:00"), LONDON)).toBe("Opens 07:00");
  });
});

describe("deskAmenityLines", () => {
  it("prints only known amenities and one fallback when nothing is known", () => {
    expect(deskAmenityLines("yes", "allowed")).toEqual(["Wifi: yes", "Laptops: allowed"]);
    expect(deskAmenityLines("yes", "unknown")).toEqual(["Wifi: yes"]);
    expect(deskAmenityLines("no", "unknown")).toEqual(["Wifi: no"]);
    expect(deskAmenityLines("unknown", "allowed")).toEqual(["Laptops: allowed"]);
    expect(deskAmenityLines("unknown", "unknown")).toEqual(["No amenity data yet"]);
  });
});

describe("desk card projection", () => {
  it("puts human hours and known amenities on the ranked card", () => {
    const hours = parseOsmOpeningHours("Mo-Fr 08:00-17:00");
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("bean", 0.001, {
        name: "Desk and Bean",
        wifi: "yes",
        laptop: "allowed",
        openingHours: hours,
        hoursRaw: "Mo-Fr 08:00-17:00",
      }),
    ], { now: new Date("2026-08-17T12:00:00+01:00"), observedAt: "2026-08-16T04:01:27.583Z" });
    const card = answer.hero;
    expect(card?.amenityLines).toEqual(["Wifi: yes", "Laptops: allowed"]);
    expect(card?.hoursCaption).toBe("Open until 17:00");
    expect(card?.hoursRaw).toBe("Mo-Fr 08:00-17:00");
    expect(card?.checkedCaption).toMatch(/^Checked /);
  });

  it("reads one clock for the open-now key and the hours line", () => {
    const hours = parseOsmOpeningHours("Mo-Fr 09:00-22:00");
    // Friday 19:30 in New York is Saturday 00:30 in London.
    const now = new Date("2026-08-14T23:30:00Z");
    const viewerZone = rankDeskNearMe(here.lat, here.lng, [
      desk("bean", 0.001, { name: "Desk and Bean", wifi: "yes", openingHours: hours }),
    ], { now, timeZone: "America/New_York" }).hero;
    expect(viewerZone?.openNow).toBe(true);
    expect(viewerZone?.hoursCaption).toBe("Open until 22:00");

    const london = rankDeskNearMe(here.lat, here.lng, [
      desk("bean", 0.001, { name: "Desk and Bean", wifi: "yes", openingHours: hours }),
    ], { now }).hero;
    expect(london?.openNow).toBe(false);
    expect(london?.hoursCaption).toBe("Closed today");
  });

  it("does not print unknown laptop or seat-data noise", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("quiet", 0.001, { name: "Quiet Corner" }),
    ]);
    expect(answer.hero?.amenityLines).toEqual(["No amenity data yet"]);
    expect(answer.hero?.hoursCaption).toBe("Hours unknown");
    expect(answer.hero?.hoursRaw).toBeNull();
  });
});

describe("desk surface debug attribute", () => {
  const collapsedAnswer = () => rankDeskNearMe(here.lat, here.lng, [
    desk("nero-1", 0.0004, { name: "Caffè Nero", wifi: "yes" }),
    desk("nero-2", 0.0005, { name: "Caffe Nero Oxford Street", wifi: "yes" }),
    desk("bean", 0.0006, { name: "Desk and Bean" }),
  ], { maxAnswers: 1 });

  it("renders the collapsed chains on the surface in development", () => {
    const answer = collapsedAnswer();
    expect(answer.collapsedChains).toEqual(["caffe nero"]);
    const markup = renderToStaticMarkup(createElement(
      "section",
      deskCollapsedChainsAttributes(answer.collapsedChains, "development"),
    ));
    expect(markup).toContain('data-desk-collapsed-chains="caffe nero"');
  });

  it("renders no debug attribute in production or with nothing collapsed", () => {
    const answer = collapsedAnswer();
    expect(renderToStaticMarkup(createElement(
      "section",
      deskCollapsedChainsAttributes(answer.collapsedChains, "production"),
    ))).toBe("<section></section>");
    expect(renderToStaticMarkup(createElement(
      "section",
      deskCollapsedChainsAttributes([], "development"),
    ))).toBe("<section></section>");
    expect(renderToStaticMarkup(createElement(
      "section",
      deskCollapsedChainsAttributes(undefined, "development"),
    ))).toBe("<section></section>");
  });
});
