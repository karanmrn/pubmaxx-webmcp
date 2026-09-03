import { describe, expect, it } from "vitest";

import {
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  SKIDDLE_SOURCE,
  TICKETMASTER_SOURCE,
  toIsoInstant,
} from "../scripts/whatson/eventsRefresh.mjs";
import {
  EVENT_DROP_REASONS,
  emptyEventDrops,
  mergeEventDrops,
  summariseEventDrops,
} from "@/lib/whatson/eventNormalise.mjs";
import { buildVenueResolverIndex, resolveVenueId } from "../scripts/whatson/resolveVenueId.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

const observedAt = "2026-07-18T09:00:00.000Z";
const now = Date.parse(observedAt);

// A canonical venue index with one pub the events can resolve against (name +
// coincident coordinates give the resolver its proximity confirmation).
const venueIndex = buildVenueResolverIndex([
  {
    pub_name: "The Dublin Castle",
    address: "94 Parkway, London NW1 7AN",
    latitude: 51.5395,
    longitude: -0.1427,
  },
]);

// --- Ticketmaster fixtures ---------------------------------------------------

const tmMusicAtKnownPub = {
  id: "tm-1",
  name: "Indie Night Live",
  url: "https://www.ticketmaster.co.uk/event/tm-1",
  dates: { start: { dateTime: "2026-07-18T20:00:00Z" } },
  classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
  priceRanges: [{ currency: "GBP", min: 12.5, max: 18 }],
  _embedded: {
    venues: [
      {
        name: "The Dublin Castle",
        postalCode: "NW1 7AN",
        address: { line1: "94 Parkway" },
        location: { latitude: "51.5395", longitude: "-0.1427" },
      },
    ],
  },
};

const tmSportsUnmatchedVenue = {
  id: "tm-2",
  name: "London Lions Basketball",
  url: "https://www.ticketmaster.co.uk/event/tm-2",
  dates: { start: { localDate: "2026-07-18", localTime: "19:30:00" } },
  classifications: [{ segment: { name: "Sports" } }],
  _embedded: { venues: [{ name: "Copper Box Arena", location: { latitude: "51.545", longitude: "-0.017" } }] },
};

describe("mapTicketmasterEvent", () => {
  it("maps a Music event at a known pub to a valid music row with provenance, price, and a resolved venueId", () => {
    const row = mapTicketmasterEvent(tmMusicAtKnownPub, { observedAt, venueIndex, resolveVenue: resolveVenueId });
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      kind: "music",
      placeName: "The Dublin Castle",
      title: "Indie Night Live",
      startsAt: "2026-07-18T20:00:00.000Z",
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/tm-1" },
      confidence: "listed",
      priceGbp: 12.5,
      detail: "Rock",
    });
    expect(row!.venueId).toBeTruthy();
    expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
  });

  it("maps a Sports event and still lists it when the venue is unmatched (no venueId, but valid row)", () => {
    const row = mapTicketmasterEvent(tmSportsUnmatchedVenue, { observedAt, venueIndex, resolveVenue: resolveVenueId });
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("sport");
    expect(row!.placeName).toBe("Copper Box Arena");
    expect(row!.venueId).toBeUndefined();
    expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
  });

  it("maps Arts & Theatre onto kind event instead of dropping it", () => {
    const row = mapTicketmasterEvent(
      { ...tmMusicAtKnownPub, classifications: [{ segment: { name: "Arts & Theatre" } }] },
      { observedAt, venueIndex, resolveVenue: resolveVenueId },
    );
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("event");
    expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
  });

  it("drops events missing provenance (no url), place name, or usable start", () => {
    expect(mapTicketmasterEvent({ ...tmMusicAtKnownPub, url: "" }, { observedAt })).toBeNull();
    expect(
      mapTicketmasterEvent({ ...tmMusicAtKnownPub, _embedded: { venues: [{}] } }, { observedAt }),
    ).toBeNull();
    expect(mapTicketmasterEvent({ ...tmMusicAtKnownPub, dates: {} }, { observedAt })).toBeNull();
  });

  it("normalises a full payload and drops non-mapping members", () => {
    const { rows, dropped } = normaliseTicketmasterEvents(
      {
        _embedded: {
          events: [
            tmMusicAtKnownPub,
            tmSportsUnmatchedVenue,
            { ...tmMusicAtKnownPub, id: "tm-3", classifications: [{ segment: { name: "Film" } }] },
          ],
        },
      },
      { observedAt, venueIndex, resolveVenue: resolveVenueId },
    );
    expect(rows).toHaveLength(2);
    expect(dropped.noKind).toBe(1);
    expect(rows.every((r) => isValidWhatsOnRow(r as unknown, now))).toBe(true);
  });

  it("returns empty rows for an absent or malformed payload", () => {
    expect(normaliseTicketmasterEvents(null).rows).toEqual([]);
    expect(normaliseTicketmasterEvents({}).rows).toEqual([]);
    expect(normaliseTicketmasterEvents({ _embedded: { events: "nope" } }).rows).toEqual([]);
  });
});

// --- Skiddle fixtures --------------------------------------------------------

const skLiveAtKnownPub = {
  id: 900,
  eventname: "Blues Jam Session",
  EventCode: "LIVE",
  link: "https://www.skiddle.com/whats-on/e/900",
  startdate: "2026-07-18 20:30:00",
  enddate: "2026-07-19 01:00:00",
  entryprice: "£8",
  genre: "Blues",
  venue: { name: "The Dublin Castle", postcode: "NW1 7AN", latitude: "51.5395", longitude: "-0.1427" },
};

const skClubDropped = {
  id: 901,
  eventname: "Warehouse Rave",
  EventCode: "CLUB",
  link: "https://www.skiddle.com/whats-on/e/901",
  startdate: "2026-07-18 22:00:00",
  venue: { name: "Some Club", latitude: "51.5", longitude: "-0.1" },
};

describe("mapSkiddleEvent", () => {
  it("maps a LIVE event at a known pub to a valid music row with a London-local start, endsAt, price, and resolved venueId", () => {
    const row = mapSkiddleEvent(skLiveAtKnownPub, { observedAt, venueIndex, resolveVenue: resolveVenueId });
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      kind: "music",
      placeName: "The Dublin Castle",
      title: "Blues Jam Session",
      source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/e/900" },
      confidence: "listed",
      priceGbp: 8,
      detail: "Blues",
    });
    // 20:30 London wall time in July (BST, +01:00) === 19:30 UTC.
    expect(row!.startsAt).toBe("2026-07-18T19:30:00.000Z");
    expect(row!.endsAt).toBe("2026-07-19T00:00:00.000Z");
    expect(row!.venueId).toBeTruthy();
    expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
  });

  it("maps CLUB onto kind event instead of dropping it", () => {
    const row = mapSkiddleEvent(skClubDropped, { observedAt, venueIndex, resolveVenue: resolveVenueId });
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("event");
    expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
  });

  it("drops events missing provenance, place name, or start", () => {
    expect(mapSkiddleEvent({ ...skLiveAtKnownPub, link: "ftp://x" }, { observedAt })).toBeNull();
    expect(mapSkiddleEvent({ ...skLiveAtKnownPub, venue: {} }, { observedAt })).toBeNull();
    expect(mapSkiddleEvent({ ...skLiveAtKnownPub, startdate: "", date: "" }, { observedAt })).toBeNull();
  });

  it("normalises a full payload", () => {
    const { rows } = normaliseSkiddleEvents(
      { results: [skLiveAtKnownPub, skClubDropped] },
      { observedAt, venueIndex, resolveVenue: resolveVenueId },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toEqual({ ...SKIDDLE_SOURCE, url: "https://www.skiddle.com/whats-on/e/900" });
    expect(rows[1].kind).toBe("event");
  });

  it("returns empty rows for absent/malformed payloads", () => {
    expect(normaliseSkiddleEvents(null).rows).toEqual([]);
    expect(normaliseSkiddleEvents({ results: "nope" }).rows).toEqual([]);
  });
});

describe("toIsoInstant", () => {
  it("passes through a timezone-qualified ISO string unchanged (as an instant)", () => {
    expect(toIsoInstant("2026-07-18T20:00:00Z")).toBe("2026-07-18T20:00:00.000Z");
    expect(toIsoInstant("2026-07-18T20:00:00+01:00")).toBe("2026-07-18T19:00:00.000Z");
  });

  it("interprets a bare wall-clock time in Europe/London (BST in July)", () => {
    expect(toIsoInstant("2026-07-18 20:30:00")).toBe("2026-07-18T19:30:00.000Z");
  });

  it("interprets a bare wall-clock time as GMT in winter", () => {
    expect(toIsoInstant("2026-01-18 20:30:00")).toBe("2026-01-18T20:30:00.000Z");
  });

  it("returns null for unusable input", () => {
    expect(toIsoInstant(null)).toBeNull();
    expect(toIsoInstant("")).toBeNull();
    expect(toIsoInstant("not a date")).toBeNull();
  });
});

describe("attribution constants", () => {
  it("every provider labels rows so the Tonight page can render 'via <source>' with a real link", () => {
    expect(TICKETMASTER_SOURCE.label).toBe("Ticketmaster");
    expect(SKIDDLE_SOURCE.label).toBe("Skiddle");
    expect(TICKETMASTER_SOURCE.url).toMatch(/^https:\/\//);
    expect(SKIDDLE_SOURCE.url).toMatch(/^https:\/\//);
  });
});

describe("event drop counters", () => {
  it("carries EVERY reason the vocabulary names, so a new one cannot be dropped in transit", () => {
    const from = emptyEventDrops();
    for (const reason of EVENT_DROP_REASONS) from[reason] = 1;
    from.total = EVENT_DROP_REASONS.length;

    const into = mergeEventDrops(emptyEventDrops(), from);
    for (const reason of EVENT_DROP_REASONS) expect(into[reason]).toBe(1);
    expect(into.total).toBe(EVENT_DROP_REASONS.length);
  });

  it("accumulates across merges and answers the counters it added into", () => {
    const into = emptyEventDrops();
    const one = { ...emptyEventDrops(), noKind: 2, total: 2 };
    expect(mergeEventDrops(into, one)).toBe(into);
    mergeEventDrops(into, { ...emptyEventDrops(), noStart: 3, total: 3 });
    expect(into.noKind).toBe(2);
    expect(into.noStart).toBe(3);
    expect(into.total).toBe(5);
  });

  it("leaves the counters alone when there is nothing to merge", () => {
    const into = { ...emptyEventDrops(), noPlace: 1, total: 1 };
    expect(mergeEventDrops(into, null)).toEqual({ ...emptyEventDrops(), noPlace: 1, total: 1 });
  });

  it("summarises every reason the vocabulary names", () => {
    const dropped = mergeEventDrops(emptyEventDrops(), {
      ...emptyEventDrops(),
      noKind: 1,
      total: 1,
    });
    const summary = summariseEventDrops(dropped);
    for (const reason of EVENT_DROP_REASONS) expect(summary).toContain(`${reason}=`);
    expect(summariseEventDrops(emptyEventDrops())).toBe("dropped 0");
  });
});
