import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  listOpen: vi.fn(),
}));

const limiter = vi.hoisted(() => ({ limited: false }));

const venueIndex = vi.hoisted(() => ({
  readable: true,
  venues: new Map<string, string>([
    ["venue-angel-islington", "The Angel"],
    ["venue-mcr-northern", "The Northern"],
  ]),
}));

vi.mock("@/lib/socialCrewStore", () => ({
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/outRateLimit", () => ({
  isOutLimited: vi.fn(async () => limiter.limited),
}));

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndexSnapshot: vi.fn(async () => ({
    index: new Map(),
    loadedCities: new Set(["london"]),
    complete: true,
  })),
  lookupCanonicalVenue: vi.fn(async (id: string) => {
    if (!venueIndex.readable) return { status: "unavailable", canonicalId: id };
    const name = venueIndex.venues.get(id);
    return name
      ? {
          status: "found",
          canonicalId: id,
          venue: { id, name, borough: "Islington", lat: 51.53, lng: -0.1 },
          slimVenue: { id, name },
        }
      : { status: "unknown", canonicalId: id };
  }),
}));

vi.mock("@/lib/planStore", () => ({
  planStateResult: vi.fn(async () => ({ ok: true, plan: null })),
}));

import { GET } from "@/app/api/out/route";
import { OUT_OPEN_PLAN_LIMIT, type OutOpenPlan } from "@/lib/out";
import * as loadOut from "@/lib/out/loadOut";
import {
  MAX_OUT_EVENTS,
  buildOutResponse,
  isOutCityCovered,
  outDayWindow,
  parseOutQuery,
} from "@/lib/out/loadOut";
import {
  OUT_DEGRADED_LINE,
  OUT_READY_CACHE_CONTROL,
  OUT_UNSETTLED_CACHE_CONTROL,
  outAnswerView,
  OUT_EMPTY_LINE,
  OUT_NOT_CONFIGURED_LINE,
  outStatusLines,
} from "@/lib/out/outStatus";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import { groupOutListings, outUnmatchedListingsNotice } from "@/lib/outDesktopGrouping";
import { londonServiceDayBounds } from "@/lib/whatsOn";
import type { OutResponse } from "@/lib/out/types";
import type { WhatsOnRow } from "@/lib/whatsOn";

const FIXTURE_NOW = new Date("2026-08-16T17:00:00.000Z");
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_TM = process.env.TICKETMASTER_API_KEY;
const ORIGINAL_SK = process.env.SKIDDLE_API_KEY;

function eventRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-tm-1",
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: "2026-08-16T19:00:00.000Z",
    title: "A Night at the Playhouse",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    sourceId: "1",
    ...overrides,
  };
}

function openPlan(overrides: Partial<OutOpenPlan> = {}): OutOpenPlan {
  return {
    crewId: "50000000-0000-4000-8000-000000000001",
    title: "Friday at the Angel",
    startTime: "2026-08-21T18:30:00.000Z",
    stopVenueId: "venue-angel-islington",
    stopVenueName: "The Angel",
    hostHandle: "alice",
    memberCount: 1,
    meetingPoint: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  limiter.limited = false;
  venueIndex.readable = true;
  store.listOpen.mockResolvedValue([]);
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.TICKETMASTER_API_KEY;
  delete process.env.SKIDDLE_API_KEY;
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  }
  if (ORIGINAL_TM === undefined) delete process.env.TICKETMASTER_API_KEY;
  else process.env.TICKETMASTER_API_KEY = ORIGINAL_TM;
  if (ORIGINAL_SK === undefined) delete process.env.SKIDDLE_API_KEY;
  else process.env.SKIDDLE_API_KEY = ORIGINAL_SK;
});

describe("parseOutQuery", () => {
  it("defaults to london / today and accepts the closed day set", () => {
    expect(parseOutQuery(new URLSearchParams())).toEqual({ city: "london", day: "today" });
    expect(parseOutQuery(new URLSearchParams("city=london&day=tomorrow"))).toEqual({
      city: "london",
      day: "tomorrow",
    });
    expect(parseOutQuery(new URLSearchParams("day=weekend"))?.day).toBe("weekend");
  });

  it("rejects an unknown day or city", () => {
    expect(parseOutQuery(new URLSearchParams("day=next-month"))).toBeNull();
    expect(parseOutQuery(new URLSearchParams("city=paris"))).toBeNull();
  });
});

describe("buildOutResponse", () => {
  const noLiveLane = () => [
    { name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [] },
    { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
  ];

  it("says the listings are off when no lane was asked AND nothing is on screen", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [], liveProviders: noLiveLane() },
    );
    // A missing key is not-configured, never an empty-market claim.
    expect(body.status).toBe("not-configured");
    expect(body.events).toEqual([]);
    expect(body.openPlans).toEqual([]);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "skiddle", configured: false, rows: 0 }),
      ]),
    );
    expect(outStatusLines({ body, failed: false })).toEqual([OUT_NOT_CONFIGURED_LINE]);
    // The sentence is about US having nothing to show, never a claim that the
    // city is quiet - we did not look - and it names no plumbing of ours.
    expect(OUT_NOT_CONFIGURED_LINE).not.toBe(OUT_EMPTY_LINE);
    expect(OUT_NOT_CONFIGURED_LINE).not.toMatch(
      /switched on|configur|set up|api|key|provider|enabled/i,
    );
  });

  it("stays ready over bundled rows at listed pubs, with no quiet line above cards", async () => {
    // A matched Common row is on screen, so quiet would contradict the cards.
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow({ venueId: "venue-soho-theatre" })],
        liveProviders: noLiveLane(),
      },
    );
    expect(body.status).toBe("ready");
    expect(body.events).toHaveLength(1);
    expect(body.venueMatch).toBe("ready");
    expect(outStatusLines({ body, failed: false })).toEqual([]);
  });

  it("leaves unmatched wording to the desktop grouping notice", async () => {
    // Populated unmatched rows are not an empty market. The grouping layer
    // names them after it drops them from cards.
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [eventRow()], liveProviders: noLiveLane() },
    );
    expect(body.status).toBe("ready");
    expect(body.events).toHaveLength(1);
    expect(body.venueMatch).toBe("ready");
    expect(outStatusLines({ body, failed: false })).toEqual([]);
  });

  it("keeps ready when a lane really was asked and answered", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          { name: "ticketmaster", isConfigured: () => true, fetchTonight: async () => [] },
          { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
        ],
      },
    );
    expect(body.status).toBe("ready");
  });

  it("keeps degraded ahead of not-configured when one lane failed", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => {
          throw new Error("events file unreadable");
        },
        liveProviders: [
          { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(outStatusLines({ body, failed: false })).toEqual([
      "Some listings could not be checked.",
    ]);
  });

  it("is degraded when a configured provider fails, and still returns bundled rows", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => {
              throw new Error("Ticketmaster Discovery API returned 503");
            },
          },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].title).toBe("A Night at the Playhouse");
    // The public body says the lane is degraded and nothing about the upstream.
    expect(body.providers[0]).toEqual({
      name: "ticketmaster",
      configured: true,
      rows: 0,
      status: "degraded",
    });
    expect(JSON.stringify(body)).not.toContain("503");
  });

  it("answers an uncovered city with an honest reason and never another city's rows", async () => {
    const body = await buildOutResponse(
      { city: "bristol", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => [eventRow({ id: "live-1", sourceId: "live-1" })],
          },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toEqual([]);
    expect(body.reason).toBe("Out does not cover Bristol yet.");
    expect(body.venueMatch).toBe("unavailable");
    expect(isOutCityCovered("london")).toBe(true);
    expect(isOutCityCovered("bristol")).toBe(false);
  });

  it("asks a live provider for the window it will keep, and the city it was asked about", async () => {
    const asked: { city?: string; window?: { startMs: number; endMs: number } }[] = [];
    await buildOutResponse(
      { city: "london", day: "tomorrow" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async (ctx) => {
              asked.push({ city: ctx.city, window: ctx.window });
              return [];
            },
          },
        ],
      },
    );
    const tomorrow = outDayWindow("tomorrow", FIXTURE_NOW.getTime());
    expect(asked).toEqual([{ city: "london", window: tomorrow }]);
  });

  it("closes the weekend at Sunday's own service end, not at Monday daytime", () => {
    // Friday 20:00 London.
    const friday = Date.parse("2026-08-14T19:00:00.000Z");
    const weekend = outDayWindow("weekend", friday);
    const sundayEvening = Date.parse("2026-08-16T20:00:00.000Z");
    const mondayMatinee = Date.parse("2026-08-17T13:00:00.000Z"); // Mon 14:00 BST
    expect(sundayEvening).toBeLessThan(weekend.endMs);
    // Sunday's evening closes at Monday 04:00; a Monday matinee is not a
    // weekend night and must fall outside the chip's window.
    expect(mondayMatinee).toBeGreaterThanOrEqual(weekend.endMs);
    expect(weekend.endMs).toBe(Date.parse(londonServiceDayBounds(sundayEvening).end));
  });

  it("keeps the weekend span honest across a BST/GMT transition", () => {
    // The clocks go back on Sunday 25 October 2026, inside this span.
    const friday = Date.parse("2026-10-23T19:00:00.000Z");
    const weekend = outDayWindow("weekend", friday);
    const sundayEvening = Date.parse("2026-10-25T20:00:00.000Z");
    expect(sundayEvening).toBeGreaterThanOrEqual(weekend.startMs);
    expect(sundayEvening).toBeLessThan(weekend.endMs);
    expect(weekend.endMs).toBe(Date.parse(londonServiceDayBounds(sundayEvening).end));
    // A raw three-day span would be an hour short of the real service window.
    expect(weekend.endMs - weekend.startMs).toBeGreaterThan(3 * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000);
  });

  it("keeps Sunday night inside the weekend window in the small hours", () => {
    // Sunday 02:00 London still belongs to SATURDAY's service evening. Reading
    // the weekday off `now` instead put Friday a day early and cut Sunday out.
    const sundaySmallHours = Date.parse("2026-08-16T01:00:00.000Z"); // Sun 02:00 BST
    const weekend = outDayWindow("weekend", sundaySmallHours);
    const sundayEvening = Date.parse("2026-08-16T20:00:00.000Z");
    expect(sundayEvening).toBeGreaterThanOrEqual(weekend.startMs);
    expect(sundayEvening).toBeLessThan(weekend.endMs);
  });

  it("windows a date-only row against its own stated evening", async () => {
    const dateOnly: WhatsOnRow = {
      id: "events-cm-1",
      placeName: "Camberwell",
      kind: "event",
      startsDate: "2026-08-16",
      timeEvidence: "Date listed, start time not published",
      title: "Sunday roast club",
      source: { label: "common", url: "https://www.common-social.com/post/abc" },
      observedAt: "2026-08-16T09:00:00.000Z",
      confidence: "listed",
    };
    const today = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [dateOnly], liveProviders: [] },
    );
    expect(today.events.map((row) => row.id)).toEqual(["events-cm-1"]);
    expect(today.events[0].startsAt).toBeUndefined();

    const tomorrow = await buildOutResponse(
      { city: "london", day: "tomorrow" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [dateOnly], liveProviders: [] },
    );
    expect(tomorrow.events).toEqual([]);
  });

  it("never treats a failed baseline read as an empty market", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => {
          throw new Error("events file unreadable");
        },
        liveProviders: [],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toEqual([]);
    expect(body.openPlans).toEqual([]);
  });

  it("caps events at 100 and sorts by startsAt", async () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      eventRow({
        id: `e-${index}`,
        sourceId: String(index),
        startsAt: new Date(Date.parse("2026-08-16T18:00:00.000Z") + (120 - index) * 60_000).toISOString(),
        title: `Row ${index}`,
      }),
    );
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => rows, liveProviders: [] },
    );
    expect(body.events).toHaveLength(MAX_OUT_EVENTS);
    expect(body.unmatchedCount).toBe(120);
    const starts = body.events.map((row) => row.startsAt ?? "");
    expect(starts).toEqual([...starts].sort());
  });

  it("counts a whitespace-only venueId as unmatched when matching is unavailable", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow({ venueId: "   " })],
        liveProviders: [],
        loadVenueMatchIndex: async () => null,
      },
    );
    expect(body.unmatchedCount).toBe(1);
  });

  it("keeps venueId on a venue-matched row so a later lane can attach price and occupancy", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow({ venueId: "venue-soho-theatre" })],
        liveProviders: [],
      },
    );
    expect(body.events[0].venueId).toBe("venue-soho-theatre");
  });
});

describe("a row with no stated time answers only the day it was listed for", () => {
  const listedTonight = () => [
    eventRow({ id: "listed-tonight", startsAt: undefined, listedWindow: "tonight" }),
  ];

  it("shows a tonight-listed row under Today", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: listedTonight, liveProviders: [] },
    );
    expect(body.events).toHaveLength(1);
  });

  it("refuses it under Tomorrow and Weekend rather than claiming the wrong day", async () => {
    for (const day of ["tomorrow", "weekend"] as const) {
      const body = await buildOutResponse(
        { city: "london", day },
        { now: FIXTURE_NOW.getTime(), loadBaseline: listedTonight, liveProviders: [] },
      );
      expect(body.events).toEqual([]);
    }
  });
});

describe("the live lanes are asked at once", () => {
  it("starts every configured provider before the first one answers", async () => {
    // Each lane carries its own request timeout. Walked one after another, two
    // slow upstreams cost more than the route's whole budget and the reader
    // gets a platform error instead of the honest degraded body.
    const trace: string[] = [];
    const lane = (name: string) => ({
      name,
      isConfigured: () => true,
      fetchTonight: async () => {
        trace.push(`start:${name}`);
        await Promise.resolve();
        await Promise.resolve();
        trace.push(`end:${name}`);
        return [] as WhatsOnRow[];
      },
    });

    await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [lane("ticketmaster"), lane("skiddle")],
      },
    );

    expect(trace.slice(0, 2)).toEqual(["start:ticketmaster", "start:skiddle"]);
  });

  it("reports one failed lane as degraded and still keeps the other lane's rows", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => {
              throw new Error("upstream 503");
            },
          },
          {
            name: "skiddle",
            isConfigured: () => true,
            fetchTonight: async () => [eventRow({ id: "sk-1", sourceId: "sk-1" })],
          },
        ],
      },
    );

    expect(body.status).toBe("degraded");
    expect(body.events).toHaveLength(1);
    expect(body.providers).toEqual([
      { name: "skiddle", configured: true, rows: 1, status: "ready" },
      { name: "ticketmaster", configured: true, rows: 0, status: "degraded" },
    ]);
  });
});

describe("the two lanes fold onto one listing", () => {
  it("shows a Ticketmaster event once, keeping the bundled row's venue match", async () => {
    const bundled = eventRow({
      id: "events-tm-bundled",
      venueId: "venue-soho-theatre",
      sourceId: "tm-1",
      observedAt: "2026-08-16T06:00:00.000Z",
    });
    // Same listing off the live seam: no venue index, so no venueId, and the
    // place name alone gives dedupeRows a different key.
    const live = eventRow({
      id: "events-tm-live",
      sourceId: "tm-1",
      observedAt: "2026-08-16T16:00:00.000Z",
      venueId: "   ",
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [bundled],
        liveProviders: [
          { name: "ticketmaster", isConfigured: () => true, fetchTonight: async () => [live] },
        ],
      },
    );
    expect(body.events).toHaveLength(1);
    expect(body.events[0].observedAt).toBe("2026-08-16T16:00:00.000Z");
    expect(body.events[0].venueId).toBe("venue-soho-theatre");
  });

  it("keeps two shows in one venue at the same minute, because their ids differ", async () => {
    // Comedy, theatre, club and BARPUB all land on the single kind "event", and
    // a live row carries no venueId, so a multi-room venue's two 20:00 shows
    // share (place, kind, start). Their provider ids do not.
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [
          eventRow({ id: "a", sourceId: "tm-1", title: "Upstairs" }),
          eventRow({ id: "b", sourceId: "tm-2", title: "Downstairs" }),
        ],
        liveProviders: [],
      },
    );
    expect(body.events.map((row) => row.sourceId)).toEqual(["tm-1", "tm-2"]);
  });

  it("leaves two genuinely different listings alone", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [
          eventRow({ id: "a", sourceId: "tm-1" }),
          eventRow({ id: "b", sourceId: "tm-2", placeName: "Another Room" }),
        ],
        liveProviders: [],
      },
    );
    expect(body.events).toHaveLength(2);
  });
});

describe("GET /api/out", () => {
  it("sets the edge cache header on a 200, matched to how settled the answer is", async () => {
    const res = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["ready", "degraded", "not-configured"]).toContain(body.status);
    expect(res.headers.get("cache-control")).toBe(
      body.status === "ready" && body.venueMatch === "ready"
        ? OUT_READY_CACHE_CONTROL
        : OUT_UNSETTLED_CACHE_CONTROL,
    );
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.openPlans).toEqual([]);
  });

  it("shortens the cache when venue matching is unavailable", async () => {
    const build = vi.spyOn(loadOut, "buildOutResponse").mockResolvedValue({
      status: "ready",
      listingsStatus: "ready",
      events: [],
      openPlans: [],
      attribution: [],
      observedAt: {},
      providers: [],
      unmatchedCount: 0,
      venueMatch: "unavailable",
    });
    try {
      const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
      expect(response.headers.get("cache-control")).toBe(OUT_UNSETTLED_CACHE_CONTROL);
    } finally {
      build.mockRestore();
    }
  });

  it("holds an unsettled answer only briefly, so one blip is not pinned on the CDN", async () => {
    // A city Out does not cover yet is the deterministic non-ready body: the
    // answer is a fact about us at one instant, not about the day.
    const res = await GET(new Request("http://localhost/api/out?city=bristol&day=today"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(res.headers.get("cache-control")).toBe(OUT_UNSETTLED_CACHE_CONTROL);
  });

  it("uses the house error envelope for a bad day", async () => {
    const res = await GET(new Request("http://localhost/api/out?day=never"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toEqual(expect.any(String));
    expect(body.code).toEqual(expect.any(String));
    expect(typeof body.retryable).toBe("boolean");
  });
});

describe("GET /api/out openPlans", () => {
  beforeEach(() => {
    process.env.TICKETMASTER_API_KEY = "test-key";
    process.env.SKIDDLE_API_KEY = "test-key";
    store.listOpen.mockResolvedValue([openPlan()]);
  });

  it("answers ready plans with the meeting point a card renders", async () => {
    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.openPlans).toHaveLength(1);
    expect(body.openPlans[0].meetingPoint).toEqual({
      kind: "venue",
      name: "The Angel",
      lat: 51.53,
      lng: -0.1,
    });
    expect(Array.isArray(body.events)).toBe(true);
    expect(store.listOpen).toHaveBeenCalledWith({
      from: expect.any(String),
      until: expect.any(String),
      city: "london",
      limit: OUT_OPEN_PLAN_LIMIT,
    });
  });

  it("marks a failed plans read degraded and keeps it off the long CDN window", async () => {
    store.listOpen.mockRejectedValue(new Error("rpc down"));
    const response = await GET(new Request("http://localhost/api/out?day=today"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(OUT_UNSETTLED_CACHE_CONTROL);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.openPlansStatus).toBe("degraded");
    expect(body.openPlans).toEqual([]);
    // The plans failure widens the WHOLE answer's status and leaves the
    // listings lane exactly as its own read left it, so a surface showing only
    // listings never apologises for a read that ran.
    const listingsOnly = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime() },
    );
    expect(body.listingsStatus).toBe(listingsOnly.status);
    expect(body.listingsReason).toBe(listingsOnly.reason);
  });

  it("keeps a healthy listings lane unmarked when only the plans read failed", async () => {
    store.listOpen.mockRejectedValue(new Error("rpc down"));
    const ready = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => [],
          },
        ],
      },
    );
    expect(ready.status).toBe("ready");
    expect(ready.listingsStatus).toBe("ready");
    // The reader-facing consequence: the lines a listings-only surface prints
    // carry no "could not be checked" claim once the plans status is split off.
    const widened = { ...ready, status: "degraded" as const, reason: OUT_DEGRADED_LINE };
    expect(outStatusLines({ body: widened, failed: false })).not.toContain(
      OUT_DEGRADED_LINE,
    );
  });

  it("keeps a successful empty open-plan list without inventing rows", async () => {
    store.listOpen.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    const body = await response.json();
    expect(body.openPlans).toEqual([]);
  });

  it("hides open crew discovery during emergency rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.openPlans).toBeNull();
    expect(body.openPlansStatus).toBe("preview");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store.listOpen).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated flood", async () => {
    limiter.limited = true;
    const response = await GET(new Request("http://localhost/api/out"));
    expect(response.status).toBe(429);
    expect(store.listOpen).not.toHaveBeenCalled();
  });
});

describe("GET /api/out city openPlans", () => {
  const manchesterPlan = openPlan({
    crewId: "50000000-0000-4000-8000-000000000002",
    title: "Northern Quarter round",
    stopVenueId: "venue-mcr-northern",
    stopVenueName: "The Northern",
  });

  beforeEach(() => {
    process.env.TICKETMASTER_API_KEY = "test-key";
    process.env.SKIDDLE_API_KEY = "test-key";
    store.listOpen.mockImplementation(async (input: { city: string }) => {
      if (input.city === "manchester") return [manchesterPlan];
      return [openPlan()];
    });
  });

  it("asks the RPC for the requested city", async () => {
    const london = await (
      await GET(new Request("http://localhost/api/out?city=london&day=today"))
    ).json();
    expect(london.openPlans.map((plan: OutOpenPlan) => plan.crewId)).toEqual([
      openPlan().crewId,
    ]);
    expect(store.listOpen).toHaveBeenCalledWith(
      expect.objectContaining({ city: "london" }),
    );

    const manchester = await (
      await GET(new Request("http://localhost/api/out?city=manchester&day=today"))
    ).json();
    expect(manchester.openPlans.map((plan: OutOpenPlan) => plan.crewId)).toEqual([
      manchesterPlan.crewId,
    ]);
    expect(store.listOpen).toHaveBeenCalledWith(
      expect.objectContaining({ city: "manchester" }),
    );
  });

  it("drops a row whose Stop 1 cannot be resolved for the meeting point", async () => {
    store.listOpen.mockResolvedValue([
      openPlan({ stopVenueId: "venue-gone-from-the-index" }),
      openPlan({ crewId: "50000000-0000-4000-8000-000000000003", stopVenueId: null }),
    ]);
    const body = await (
      await GET(new Request("http://localhost/api/out?city=london&day=today"))
    ).json();
    expect(body.openPlans).toEqual([]);
  });

  it("degrades rather than emptying the market when the index cannot be read", async () => {
    venueIndex.readable = false;
    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(response.headers.get("cache-control")).toBe(OUT_UNSETTLED_CACHE_CONTROL);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.openPlans).toEqual([]);
  });
});

describe("outStatusLines", () => {
  it("never words a degraded answer as an empty market", () => {
    expect(
      outStatusLines({
        body: { status: "degraded", events: [], reason: "Out does not cover Bristol yet." },
        failed: false,
      }),
    ).toEqual(["Out does not cover Bristol yet."]);
    expect(outStatusLines({ body: { status: "degraded", events: [] }, failed: false })).toEqual([
      "Some listings could not be checked.",
    ]);
  });

  it("keeps a pending day as a skeleton, never a checking sentence", () => {
    // A read still in flight has no body and has not failed, and it says
    // nothing: the skeleton is the wake state, so a sentence here would be a
    // claim about a market nobody has read yet.
    expect(outStatusLines({ body: null, failed: false })).toEqual([]);
    // A failed read owns the line instead.
    expect(outStatusLines({ body: null, failed: true })).toEqual([
      "Could not check listings.",
    ]);
    // Once an answer lands the empty line is the read's own.
    expect(
      outStatusLines({ body: { status: "ready", events: [] }, failed: false }),
    ).toEqual(["No listings for this day yet."]);
  });

  it("says the city is quiet only when the read actually answered", () => {
    expect(outStatusLines({ body: { status: "ready", events: [] }, failed: false })).toEqual([
      "No listings for this day yet.",
    ]);
    expect(outStatusLines({ body: null, failed: true })).toEqual(["Could not check listings."]);
    expect(
      outStatusLines({ body: { status: "ready", events: [eventRow()] }, failed: false }),
    ).toEqual([]);
  });
});

describe("outAnswerView", () => {
  const heldBody: Pick<OutResponse, "status" | "events" | "reason"> = {
    status: "ready",
    events: [],
  };
  const answer = { day: "today" as const, body: heldBody, failed: false };

  it("is pending before the FIRST answer lands, not only on a day switch", () => {
    // A reader opening /out meets the heading and the chips; nothing has
    // answered yet, so the surface says so rather than showing a blank area.
    const view = outAnswerView<Pick<OutResponse, "status" | "events" | "reason">>(null, "today");
    expect(view).toEqual({ body: null, failed: false, pending: true });
    expect(outStatusLines({ ...view })).toEqual([]);
  });

  it("is pending again the moment another day is pressed, holding no stale cards", () => {
    const view = outAnswerView(answer, "weekend");
    expect(view.body).toBeNull();
    expect(view.pending).toBe(true);
  });

  it("hands back the held answer once it is about the day on screen", () => {
    const view = outAnswerView(answer, "today");
    expect(view).toEqual({ body: answer.body, failed: false, pending: false });
    expect(outStatusLines({ ...view })).toEqual(["No listings for this day yet."]);
  });

  it("carries a failed read for its own day, and never as another day's", () => {
    const held = { day: "tomorrow" as const, body: null, failed: true };
    expect(outAnswerView(held, "tomorrow")).toEqual({ body: null, failed: true, pending: false });
    expect(outAnswerView(held, "today")).toEqual({ body: null, failed: false, pending: true });
  });
});

describe("the live lane is venue-matched at request time", () => {
  // The loss point: /api/out served four Ticketmaster rows with no venueId
  // because matching lived only in the refresh CLI, so /out dropped every one
  // of them and printed a bare status line over an empty page.
  const slimIndex = buildOutVenueMatchIndex([
    { id: "venue-1137z1c", name: "The Lexington", borough: "Islington", lat: 51.5326, lng: -0.1119 },
    { id: "venue-1d1tez", name: "The Dublin Castle", borough: "Camden", lat: 51.5397, lng: -0.1429 },
  ]);
  const liveLexington = eventRow({
    id: "events-tm-lex",
    sourceId: "tm-lex",
    kind: "music",
    placeName: "The Lexington",
    title: "Live band night",
    lat: 51.5326,
    lng: -0.1119,
  });
  const liveArena = eventRow({
    id: "events-tm-o2",
    sourceId: "tm-o2",
    placeName: "The O2",
    title: "Arena show",
    lat: 51.503,
    lng: 0.0032,
  });
  const ticketmaster = (rows: WhatsOnRow[]) => ({
    name: "ticketmaster",
    isConfigured: () => true,
    fetchTonight: async () => rows,
  });

  it("gives a live row with a listed venue name its venueId, so it reaches the pub list", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [ticketmaster([liveLexington])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.status).toBe("ready");
    expect(body.venueMatch).toBe("ready");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].venueId).toBe("venue-1137z1c");
    // Matched rows enter the pub list under the EXISTING rule, unchanged.
    expect(groupOutListings(body.events).map((group) => group.key)).toEqual([
      "venue:venue-1137z1c",
    ]);
  });

  it("keeps an unmatched live row out of the pub list and counts it in the notice", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [ticketmaster([liveLexington, liveArena])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events).toHaveLength(2);
    const arena = body.events.find((row) => row.id === "events-tm-o2");
    expect(arena?.venueId).toBeUndefined();
    expect(groupOutListings(body.events).flatMap((group) => group.rows.map((row) => row.id))).toEqual([
      "events-tm-lex",
    ]);
    expect(body.unmatchedCount).toBe(1);
    const notice = outUnmatchedListingsNotice(
      body.events,
      "tonight",
      body.venueMatch,
      {
        unmatchedCount: body.unmatchedCount,
        unmatchedPlaces: body.unmatchedPlaces,
        unmatchedSources: body.unmatchedSources,
      },
    );
    expect(notice?.line).toBe("1 more listing tonight is at a place we don't list yet.");
    expect(notice?.places).toBe("");
  });

  it("keeps pre-cap unmatched places and credits for the empty-state notice", async () => {
    const matchedRows = Array.from({ length: MAX_OUT_EVENTS }, (_, index) =>
      eventRow({
        id: "matched-" + index,
        sourceId: "matched-" + index,
        title: "Matched " + index,
        venueId: "venue-1137z1c",
        startsAt: "2026-08-16T18:00:00.000Z",
      }),
    );
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [
          ticketmaster([
            ...matchedRows,
            { ...liveArena, startsAt: "2026-08-16T23:00:00.000Z" },
          ]),
        ],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events).toHaveLength(MAX_OUT_EVENTS);
    expect(body.unmatchedCount).toBe(1);
    expect(body.unmatchedPlaces).toEqual(["The O2"]);
    expect(body.unmatchedPlaceCount).toBe(1);
    expect(body.unmatchedSources).toEqual(["Ticketmaster"]);
    const notice = outUnmatchedListingsNotice(
      body.events,
      "tonight",
      body.venueMatch,
      {
        unmatchedCount: body.unmatchedCount,
        unmatchedPlaces: body.unmatchedPlaces,
        unmatchedSources: body.unmatchedSources,
      },
    );
    expect(notice?.line).toBe("1 more listing tonight is at a place we don't list yet.");
    expect(notice?.places).toBe("");
    expect(notice?.credits.map((credit) => credit.label)).toEqual(["Ticketmaster"]);
  });

  it("names unmatched rows when only unmatched rows survive the serve cap", async () => {
    const unmatchedRows = Array.from({ length: MAX_OUT_EVENTS }, (_, index) =>
      eventRow({
        id: `unmatched-${index}`,
        sourceId: `unmatched-${index}`,
        placeName: `Unlisted place ${index}`,
        title: `Unmatched ${index}`,
        startsAt: "2026-08-16T18:00:00.000Z",
      }),
    );
    const matchedAfterCap = eventRow({
      id: "matched-after-cap",
      sourceId: "matched-after-cap",
      venueId: "venue-1137z1c",
      startsAt: "2026-08-16T23:00:00.000Z",
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [ticketmaster([...unmatchedRows, matchedAfterCap])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(groupOutListings(body.events)).toEqual([]);
    const notice = outUnmatchedListingsNotice(body.events, "tonight", body.venueMatch, {
      unmatchedCount: body.unmatchedCount,
      unmatchedPlaces: body.unmatchedPlaces,
      unmatchedPlaceCount: body.unmatchedPlaceCount,
      unmatchedSources: body.unmatchedSources,
    });
    expect(notice?.line).toBe("100 listings tonight are at places we don't list yet.");
  });

  it("never serves a live row whose start has already passed", async () => {
    const yesterday = eventRow({
      id: "events-tm-past",
      sourceId: "tm-past",
      placeName: "The Lexington",
      title: "Last night's gig",
      startsAt: "2026-08-15T19:30:00.000Z",
      lat: 51.5326,
      lng: -0.1119,
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [ticketmaster([yesterday, liveLexington])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events.map((row) => row.id)).toEqual(["events-tm-lex"]);
  });

  it("never serves a same-night row after its effective end", async () => {
    const finished = eventRow({
      id: "events-tm-finished",
      sourceId: "tm-finished",
      placeName: "The Lexington",
      title: "Finished gig",
      startsAt: "2026-08-16T18:00:00.000Z",
      lat: 51.5326,
      lng: -0.1119,
    });
    const now = Date.parse("2026-08-16T22:30:00.000Z");
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now,
        loadBaseline: () => [],
        liveProviders: [ticketmaster([finished])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events).toEqual([]);
  });

  it("says the match could not run when the venue index is unreadable, and changes no row", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [ticketmaster([liveLexington])],
        loadVenueMatchIndex: async () => {
          throw new Error("slim index unreadable");
        },
      },
    );
    // The listings themselves were read fine: the lane stays ready.
    expect(body.status).toBe("ready");
    expect(body.venueMatch).toBe("unavailable");
    expect(body.events[0].venueId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("unreadable");
  });

  it("does not re-match a row the bundled lane already matched", async () => {
    const bundled = eventRow({
      id: "events-tm-lex",
      sourceId: "tm-lex",
      placeName: "The Lexington",
      venueId: "venue-from-refresh",
      lat: 51.5326,
      lng: -0.1119,
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [bundled],
        liveProviders: [ticketmaster([liveLexington])],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events).toHaveLength(1);
    expect(body.events[0].venueId).toBe("venue-from-refresh");
  });

  it("does not promote an unresolved bundled row through the weaker live matcher", async () => {
    const unresolvedBundled = eventRow({
      id: "events-bundled-lex",
      sourceId: "bundled-lex",
      placeName: "The Lexington",
      venueId: undefined,
      lat: 51.5326,
      lng: -0.1119,
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [unresolvedBundled],
        liveProviders: [],
        loadVenueMatchIndex: async () => slimIndex,
      },
    );
    expect(body.events[0].venueId).toBeUndefined();
    expect(body.unmatchedCount).toBe(1);
  });
});
