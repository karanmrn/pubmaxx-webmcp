import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEventbriteProvider,
  EVENTBRITE_SOURCE,
  fetchEventbriteTonightRows,
  mapEventbriteEvent,
  normaliseEventbriteEvents,
  resetEventbriteCache,
} from "@/lib/events/eventbrite";
import { aggregateTonightEvents, type EventsProvider } from "@/lib/events/provider";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

// A Saturday 19:00 BST. Tonight window is [2026-07-18 16:00, 2026-07-19 04:00]
// London, i.e. [15:00Z, 03:00Z]. Events at 20:00 BST (19:00Z) fall inside it.
const observedAt = "2026-07-18T18:00:00.000Z";
const now = Date.parse(observedAt);
const opts = { observedAt, now };

const musicEvent = {
  id: "eb-1",
  name: { text: "Basement Live Session" },
  url: "https://www.eventbrite.com/e/basement-live-session-eb-1",
  start: { utc: "2026-07-18T19:00:00Z" },
  end: { utc: "2026-07-18T22:00:00Z" },
  category_id: "103",
  is_free: true,
  venue: { name: "The Windmill Brixton", latitude: "51.4626", longitude: "-0.1145" },
};

const sportEvent = {
  id: "eb-2",
  name: { text: "Boxing Fight Night Screening" },
  url: "https://www.eventbrite.com/e/fight-night-eb-2",
  start: { utc: "2026-07-18T20:30:00Z" },
  category_id: "108",
  venue: { name: "The Sports Bar" },
};

describe("mapEventbriteEvent", () => {
  it("maps a Music event to a valid free music row with provenance and coords", () => {
    const row = mapEventbriteEvent(musicEvent, opts);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      placeName: "The Windmill Brixton",
      kind: "music",
      startsAt: "2026-07-18T19:00:00.000Z",
      endsAt: "2026-07-18T22:00:00.000Z",
      title: "Basement Live Session",
      source: { ...EVENTBRITE_SOURCE, url: musicEvent.url },
      confidence: "listed",
      priceGbp: 0,
      lat: 51.4626,
      lng: -0.1145,
    });
    expect(isValidWhatsOnRow(row as WhatsOnRow, now)).toBe(true);
  });

  it("maps a Sports category to kind:'sport'", () => {
    expect(mapEventbriteEvent(sportEvent, opts)?.kind).toBe("sport");
  });

  it("drops an event whose category does not map to our four kinds", () => {
    expect(mapEventbriteEvent({ ...musicEvent, category_id: "105" }, opts)).toBeNull(); // 105 = Performing Arts
  });

  it("drops an event with no venue name (cannot attribute a place)", () => {
    expect(mapEventbriteEvent({ ...musicEvent, venue: { name: "" } }, opts)).toBeNull();
  });

  it("drops an event with a non-http url (provenance non-negotiable)", () => {
    expect(mapEventbriteEvent({ ...musicEvent, url: "ftp://x" }, opts)).toBeNull();
  });

  it("drops an event with no usable start", () => {
    expect(mapEventbriteEvent({ ...musicEvent, start: { utc: "" } }, opts)).toBeNull();
  });

  it("does NOT set priceGbp when the event is not free", () => {
    const row = mapEventbriteEvent({ ...sportEvent }, opts);
    expect(row?.priceGbp).toBeUndefined();
  });
});

describe("normaliseEventbriteEvents", () => {
  it("maps the mappable events out of an org-events payload and drops the rest", () => {
    const rows = normaliseEventbriteEvents(
      { events: [musicEvent, sportEvent, { ...musicEvent, category_id: "999" }] },
      opts,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => isValidWhatsOnRow(r, now))).toBe(true);
  });

  it("returns [] for a payload with no events array", () => {
    expect(normaliseEventbriteEvents({}, opts)).toEqual([]);
    expect(normaliseEventbriteEvents(null, opts)).toEqual([]);
  });
});

describe("fetchEventbriteTonightRows", () => {
  const ORIGINAL = process.env.EVENTBRITE_API_TOKEN;
  beforeEach(() => {
    resetEventbriteCache();
    process.env.EVENTBRITE_API_TOKEN = "test-token";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EVENTBRITE_API_TOKEN;
    else process.env.EVENTBRITE_API_TOKEN = ORIGINAL;
  });

  it("returns [] with no network call when the token is absent", async () => {
    delete process.env.EVENTBRITE_API_TOKEN;
    const fetchImpl = vi.fn();
    const rows = await fetchEventbriteTonightRows({ now, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(rows).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists own orgs then fetches each org's events and maps them", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/users/me/organizations/")) {
        return new Response(JSON.stringify({ organizations: [{ id: "org-1" }] }), { status: 200 });
      }
      if (u.includes("/organizations/org-1/events/")) {
        expect(u).toContain("start_date.range_start=");
        expect(u).toContain("expand=venue");
        return new Response(JSON.stringify({ events: [musicEvent, sportEvent] }), { status: 200 });
      }
      throw new Error(`unexpected url ${u}`);
    });
    const rows = await fetchEventbriteTonightRows({
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("contributes zero rows when the account owns no organizations (the real-world capability today)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ organizations: [] }), { status: 200 }),
    );
    const rows = await fetchEventbriteTonightRows({
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // orgs listed, no events call
  });

  it("caches within the TTL (a second call issues no new requests)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes("/organizations/org-1/events/")
        ? new Response(JSON.stringify({ events: [musicEvent] }), { status: 200 })
        : new Response(JSON.stringify({ organizations: [{ id: "org-1" }] }), { status: 200 }),
    );
    const ctx = { now, fetchImpl: fetchImpl as unknown as typeof fetch };
    await fetchEventbriteTonightRows(ctx);
    await fetchEventbriteTonightRows(ctx);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // second call served from cache
  });
});

describe("aggregateTonightEvents", () => {
  beforeEach(() => resetEventbriteCache());

  const stubProvider = (
    name: string,
    rows: WhatsOnRow[] | (() => Promise<WhatsOnRow[]>),
    configured = true,
  ): EventsProvider => ({
    name,
    isConfigured: () => configured,
    fetchTonight: typeof rows === "function" ? rows : async () => rows,
  });

  const mkRow = (id: string, startsAt: string): WhatsOnRow => ({
    id,
    placeName: "The Windmill Brixton",
    kind: "music",
    startsAt,
    title: "Gig",
    source: EVENTBRITE_SOURCE,
    observedAt,
    confidence: "listed",
  });

  it("skips unconfigured providers without calling them and reports them", async () => {
    const called = vi.fn(async () => []);
    const { rows, providers } = await aggregateTonightEvents(
      [stubProvider("off", called, false)],
      { now },
    );
    expect(rows).toEqual([]);
    expect(called).not.toHaveBeenCalled();
    expect(providers).toEqual([{ name: "off", configured: false, rows: 0 }]);
  });

  it("isolates a throwing provider (fail-soft) while keeping healthy rows", async () => {
    const good = stubProvider("good", [mkRow("r1", "2026-07-18T19:00:00Z")]);
    const bad = stubProvider("bad", async () => {
      throw new Error("upstream 500");
    });
    const { rows, providers } = await aggregateTonightEvents([good, bad], { now });
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
    expect(providers.find((p) => p.name === "bad")?.error).toMatch(/upstream 500/);
  });

  it("re-windows to tonight and de-dupes the union", async () => {
    const inWindow = mkRow("r1", "2026-07-18T19:00:00Z");
    const dayEarlier = mkRow("r2", "2026-07-17T19:00:00Z"); // outside tonight -> dropped
    const { rows } = await aggregateTonightEvents(
      [stubProvider("a", [inWindow, dayEarlier]), stubProvider("b", [inWindow])],
      { now },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("r1");
  });
});

describe("createEventbriteProvider", () => {
  const ORIGINAL = process.env.EVENTBRITE_API_TOKEN;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EVENTBRITE_API_TOKEN;
    else process.env.EVENTBRITE_API_TOKEN = ORIGINAL;
  });

  it("reports configured only when the token is present", () => {
    delete process.env.EVENTBRITE_API_TOKEN;
    expect(createEventbriteProvider().isConfigured()).toBe(false);
    process.env.EVENTBRITE_API_TOKEN = "x";
    expect(createEventbriteProvider().isConfigured()).toBe(true);
  });
});
