import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { DATE_ONLY_TIME_EVIDENCE } from "@/lib/whatson/eventNormalise.mjs";
import {
  EVENT_REFRESH_CITIES,
  SKIDDLE_EVENTCODE_KIND,
  TICKETMASTER_SEGMENT_KIND,
  dedupeEventRowsBySourceId,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  isPullRequestPermissionError,
  publishEventsReview,
  providerLaneStatus,
  readExistingRowsForLabels,
  runEventsRefresh,
  skiddleLaneFenced,
  WITH_COMMON_FLAG,
  summariseEventDrops,
} from "../scripts/whatson/eventsRefresh.mjs";
import { commandsForMode } from "../scripts/local-refresh/scheduler.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

const temporaryDirs: string[] = [];
afterAll(() => {
  for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

const observedAt = "2026-08-16T09:00:00.000Z";
const now = Date.parse(observedAt);

const tmTheatre = {
  id: "tm-theatre-1",
  name: "A Night at the Playhouse",
  url: "https://www.ticketmaster.co.uk/event/tm-theatre-1",
  dates: { start: { dateTime: "2026-08-16T19:00:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Theatre" } }],
  images: [{ url: "https://img.ticketmaster.com/theatre.jpg" }],
  priceRanges: [{ currency: "GBP", min: 28 }],
  _embedded: {
    venues: [
      {
        name: "Soho Theatre",
        location: { latitude: "51.5145", longitude: "-0.132" },
      },
    ],
  },
};

const tmComedy = {
  id: "tm-comedy-1",
  name: "Late Stand-up",
  url: "https://www.ticketmaster.co.uk/event/tm-comedy-1",
  dates: { start: { dateTime: "2026-08-16T20:30:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Comedy" } }],
  _embedded: { venues: [{ name: "The Comedy Store" }] },
};

const tmMusic = {
  id: "tm-music-1",
  name: "Indie Night Live",
  url: "https://www.ticketmaster.co.uk/event/tm-music-1",
  dates: { start: { dateTime: "2026-08-16T20:00:00Z" } },
  classifications: [{ segment: { name: "Music" } }],
  _embedded: { venues: [{ name: "The Dublin Castle" }] },
};

const tmFilmDropped = {
  id: "tm-film-1",
  name: "A Screening",
  url: "https://www.ticketmaster.co.uk/event/tm-film-1",
  dates: { start: { dateTime: "2026-08-16T18:00:00Z" } },
  classifications: [{ segment: { name: "Film" } }],
  _embedded: { venues: [{ name: "A Cinema" }] },
};

describe("Ticketmaster / Skiddle kind mapping", () => {
  it("maps theatre and comedy onto kind event instead of dropping them", () => {
    expect(TICKETMASTER_SEGMENT_KIND["Arts & Theatre"]).toBe("event");
    const theatre = mapTicketmasterEvent(tmTheatre, { observedAt });
    const comedy = mapTicketmasterEvent(tmComedy, { observedAt });
    expect(theatre).toMatchObject({
      kind: "event",
      sourceId: "tm-theatre-1",
      imageUrl: "https://img.ticketmaster.com/theatre.jpg",
      priceGbp: 28,
      source: { label: "Ticketmaster", url: tmTheatre.url },
    });
    expect(comedy?.kind).toBe("event");
    expect(isValidWhatsOnRow(theatre as unknown, now)).toBe(true);
    expect(isValidWhatsOnRow(comedy as unknown, now)).toBe(true);
  });

  it("maps Skiddle club, comedy, theatre and BARPUB onto kind event", () => {
    expect(SKIDDLE_EVENTCODE_KIND.CLUB).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.COMEDY).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.THEATRE).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.BARPUB).toBe("event");
    const club = mapSkiddleEvent(
      {
        id: 901,
        eventname: "Warehouse Night",
        EventCode: "CLUB",
        link: "https://www.skiddle.com/whats-on/e/901",
        startdate: "2026-08-16 22:00:00",
        venue: { name: "A Basement" },
      },
      { observedAt },
    );
    expect(club).toMatchObject({
      kind: "event",
      sourceId: "901",
      source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/e/901" },
    });
    expect(isValidWhatsOnRow(club as unknown, now)).toBe(true);
  });

  it("carries a Skiddle bare date as a DATE, never an invented 20:00 start", () => {
    const bareDate = mapSkiddleEvent(
      {
        id: 902,
        eventname: "Sunday session",
        EventCode: "BARPUB",
        link: "https://www.skiddle.com/whats-on/e/902",
        date: "2026-08-16",
        enddate: "2026-08-16 23:00:00",
        venue: { name: "The Dublin Castle" },
      },
      { observedAt },
    );
    expect(bareDate?.startsAt).toBeUndefined();
    expect(bareDate?.startsDate).toBe("2026-08-16");
    expect(bareDate?.timeEvidence).toBe(DATE_ONLY_TIME_EVIDENCE);
    // An endsAt without an exact start is not an interval, so it is dropped
    // rather than pairing a real close with a start nobody published.
    expect(bareDate?.endsAt).toBeUndefined();
    expect(JSON.stringify(bareDate)).not.toContain("20:00");
    expect(isValidWhatsOnRow(bareDate as unknown, now)).toBe(true);
  });

  it("keeps the exact clock when Skiddle really states one", () => {
    const timed = mapSkiddleEvent(
      {
        id: 903,
        eventname: "Doors at eight",
        EventCode: "CLUB",
        link: "https://www.skiddle.com/whats-on/e/903",
        date: "2026-08-16",
        openingtimes: { doorsopen: "2026-08-16 20:00:00" },
        venue: { name: "A Basement" },
      },
      { observedAt },
    );
    expect(timed?.startsDate).toBeUndefined();
    expect(timed?.timeEvidence).toBeUndefined();
    expect(timed?.startsAt).toBe("2026-08-16T19:00:00.000Z");
  });

  it("still maps Music to music and LIVE to music", () => {
    expect(mapTicketmasterEvent(tmMusic, { observedAt })?.kind).toBe("music");
    expect(
      mapSkiddleEvent(
        {
          id: 900,
          eventname: "Blues Jam",
          EventCode: "LIVE",
          link: "https://www.skiddle.com/whats-on/e/900",
          startdate: "2026-08-16 20:30:00",
          venue: { name: "The Dublin Castle" },
        },
        { observedAt },
      )?.kind,
    ).toBe("music");
  });
});

describe("dropped-row counts", () => {
  it("counts dropped Film / missing-field rows instead of staying silent", () => {
    const { rows, dropped } = normaliseTicketmasterEvents(
      { _embedded: { events: [tmMusic, tmTheatre, tmFilmDropped, { id: "bare" }] } },
      { observedAt },
    );
    expect(rows.map((row) => row.sourceId)).toEqual(["tm-music-1", "tm-theatre-1"]);
    expect(dropped.total).toBe(2);
    expect(dropped.noKind + dropped.noPlace + dropped.noStart + dropped.noUrl + dropped.noTitle).toBe(
      dropped.total,
    );
    expect(summariseEventDrops(dropped)).toMatch(/dropped 2/);
  });

  it("counts a Skiddle DATE drop", () => {
    const { rows, dropped } = normaliseSkiddleEvents(
      {
        results: [
          {
            id: 7,
            eventname: "Speed dating",
            EventCode: "DATE",
            link: "https://www.skiddle.com/whats-on/e/7",
            startdate: "2026-08-16 19:00:00",
            venue: { name: "A Bar" },
          },
        ],
      },
      { observedAt },
    );
    expect(rows).toEqual([]);
    expect(dropped.noKind).toBe(1);
    expect(summariseEventDrops(dropped)).toMatch(/noKind=1/);
  });
});

describe("sourceId dedupe", () => {
  it("keeps one row per provider sourceId", () => {
    const first = mapTicketmasterEvent(tmTheatre, { observedAt })!;
    const second = mapTicketmasterEvent(
      { ...tmTheatre, name: "A Night at the Playhouse (late)" },
      { observedAt },
    )!;
    const deduped = dedupeEventRowsBySourceId([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sourceId).toBe("tm-theatre-1");
  });
});

describe("keyless lanes", () => {
  it("names Skiddle not-configured when the key is absent, never an empty market", () => {
    const lanes = providerLaneStatus({ TICKETMASTER_API_KEY: "tm-present" });
    expect(lanes.ticketmaster).toBe("configured");
    expect(lanes.skiddle).toBe("not-configured");
    expect(lanes.skiddle).not.toBe("empty");
  });

  it("names both lanes not-configured with no keys", () => {
    const lanes = providerLaneStatus({});
    expect(lanes.ticketmaster).toBe("not-configured");
    expect(lanes.skiddle).toBe("not-configured");
    expect(lanes.contextdev).toBe("not-configured");
  });
});

describe("city readiness", () => {
  it("is ready for London plus the map cities the brief names", () => {
    expect(EVENT_REFRESH_CITIES).toEqual([
      "london",
      "bristol",
      "cambridge",
      "glasgow",
      "liverpool",
      "manchester",
      "oxford",
    ]);
  });
});

describe("local scheduler events mode", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it("runs the official refresh then the Common reader, as INDEPENDENT lanes", () => {
    const commands = commandsForMode("events", false);
    expect(commands.map((command) => command.args)).toEqual([
      ["scripts/whatson/eventsRefresh.mjs"],
      ["scripts/whatson/commonRefresh.mjs"],
    ]);
    // eventsRefresh exits non-zero on ordinary outcomes (an upstream 5xx, or
    // its deliberate "0 mappable rows, refusing to clobber" refusal). Common
    // depends on Ticketmaster for nothing, so it must still run.
    expect(commands.every((command) => command.independent === true)).toBe(true);
    // And the Common lane declares no key requirement, so a keyless machine
    // still runs it.
    expect(commands[1].requiresAnyKey).toBeUndefined();
  });
});

describe("runEventsRefresh end to end", () => {
  const NOW_MS = Date.parse("2026-08-16T09:00:00.000Z");

  function temporaryOutPath() {
    const dir = mkdtempSync(join(tmpdir(), "events-refresh-"));
    temporaryDirs.push(dir);
    return join(dir, "events_london.json");
  }

  function ticketmasterResponse() {
    return new Response(JSON.stringify({ _embedded: { events: [tmTheatre] } }), { status: 200 });
  }

  it("writes the file with both source descriptors on a keyed run", async () => {
    const outPath = temporaryOutPath();
    const commonCalls: unknown[] = [];
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--with-common"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => ticketmasterResponse()) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async (options) => {
        commonCalls.push(options);
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    // payload.sources is where the two source constants are read. A binding
    // that only re-exported them made this line a ReferenceError, and nothing
    // was ever written.
    expect(written.sources.map((source: { label: string }) => source.label)).toEqual([
      "Ticketmaster",
      "Skiddle",
      "Context.dev registered sources",
    ]);
    expect(written.generatedAt).toBe(new Date(NOW_MS).toISOString());
    expect(written.rows).toHaveLength(1);
    expect(commonCalls).toHaveLength(1);
  });

  it("reads back one lane's own held rows, which is the per-provider clobber guard", async () => {
    const outPath = temporaryOutPath();
    const row = (id: string, label: string) => ({
      id,
      placeName: "Soho Theatre",
      kind: "event",
      startsAt: "2026-08-16T19:00:00.000Z",
      title: id,
      source: { label, url: `https://example.com/${id}` },
      observedAt: "2026-08-15T09:00:00.000Z",
      confidence: "listed",
      sourceId: id,
    });
    writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2026-08-15T09:00:00.000Z",
        kind: "events",
        region: "greater-london",
        rows: [row("tm-1", "Ticketmaster"), row("sk-1", "Skiddle"), row("cm-1", "common")],
      }),
    );

    expect(readExistingRowsForLabels(outPath, ["Ticketmaster"]).map((r) => r.id)).toEqual(["tm-1"]);
    expect(readExistingRowsForLabels(outPath, ["skiddle", "common"]).map((r) => r.id)).toEqual([
      "sk-1",
      "cm-1",
    ]);
    expect(readExistingRowsForLabels(outPath, [])).toEqual([]);
    expect(readExistingRowsForLabels(join(outPath, "missing.json"), ["Ticketmaster"])).toEqual([]);
  });

  it("asks every provider lane after one of them fails, and writes nothing", async () => {
    // A failed lane must not abort the others: the run owes an operator each
    // lane's own outcome. The WRITE is what the failure stops, because the file
    // is overwritten whole and a partial write publishes the failed lane empty.
    const outPath = temporaryOutPath();
    const logs: string[] = [];
    const errors: string[] = [];
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "tm-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response("upstream down", { status: 503 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      log: (message) => logs.push(message),
      logError: (message) => errors.push(message),
    });

    expect(result.provider.status).toBe("failed");
    expect(result.provider.wrote).toBe(false);
    expect(result.provider.reason).toContain("ticketmaster");
    expect(existsSync(outPath)).toBe(false);
    // The Skiddle lane still reported its own outcome, so the log describes
    // what really happened rather than a per-provider skip that did not.
    expect(logs.some((line) => line.includes("Skiddle lane not-configured"))).toBe(true);
    expect(errors.some((line) => line.includes(`not writing ${outPath}`))).toBe(true);
  });

  it("runs the keyless Common lane even when the Ticketmaster lane fails", async () => {
    const outPath = temporaryOutPath();
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--with-common"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => new Response("upstream down", { status: 503 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("failed");
    expect(commonRan).toBe(true);
    expect(result.common.status).toBe("ran");
    // The exit code stays honest about the lane that failed.
    expect(result.ok).toBe(false);
  });

  it("runs the Common lane through the zero-rows no-clobber refusal", async () => {
    const outPath = temporaryOutPath();
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--with-common"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [] } }), { status: 200 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("refused");
    expect(existsSync(outPath)).toBe(false);
    expect(commonRan).toBe(true);
  });

  it("still refuses to clobber when held Common rows are the only rows left", async () => {
    // The guard counts the rows THIS run fetched. Held Common rows are merged
    // afterwards, so one carried-over listing can never keep the count non-zero
    // and let a quiet Ticketmaster window quietly drop yesterday's provider rows.
    const outPath = temporaryOutPath();
    const held = {
      generatedAt: "2026-08-15T09:00:00.000Z",
      kind: "events",
      region: "greater-london",
      city: "london",
      sources: [],
      rows: [
        {
          id: "events-common-1",
          placeName: "The Ivy House",
          kind: "event",
          startsDate: "2026-08-16",
          timeEvidence: DATE_ONLY_TIME_EVIDENCE,
          title: "Sunday session",
          source: { label: "Common", url: "https://common.example/e/1" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
          sourceId: "common-1",
        },
        {
          id: "events-tm-9",
          placeName: "Soho Theatre",
          kind: "event",
          startsAt: "2026-08-16T19:00:00.000Z",
          title: "Yesterday's provider row",
          source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/9" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
          sourceId: "9",
        },
      ],
    };
    writeFileSync(outPath, JSON.stringify(held, null, 2));

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [] } }), {
          status: 200,
        })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("refused");
    const onDisk = JSON.parse(readFileSync(outPath, "utf8"));
    expect(onDisk.generatedAt).toBe("2026-08-15T09:00:00.000Z");
    expect(onDisk.rows.map((row: { id: string }) => row.id)).toEqual([
      "events-common-1",
      "events-tm-9",
    ]);
  });

  it("keeps the run green when a refusal sits beside a lane that did publish", async () => {
    // A quiet upstream window is an ordinary outcome. An operator reading a red
    // job beside an open review PR cannot tell that from a real failure.
    const outPath = temporaryOutPath();
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", WITH_COMMON_FLAG, "--open-pr"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [] } }), {
          status: 200,
        })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      validate: () => {},
      openPr: () => {},
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("refused");
    expect(result.common.status).toBe("ran");
    expect(result.published.status).toBe("ran");
    expect(result.ok).toBe(true);
  });

  it("treats a Common refusal as a refusal, not a write", async () => {
    // The Common lane refuses its own write when a blind run would empty the
    // rows the file already holds. Counting that as a write opened a review PR
    // over a file nobody had written.
    const outPath = temporaryOutPath();
    let published = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", WITH_COMMON_FLAG, "--open-pr"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [] } }), {
          status: 200,
        })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [], wrote: false, refused: "sitemap listed no post" }),
      validate: () => {},
      openPr: () => {
        published = true;
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.common.status).toBe("refused");
    expect(published).toBe(false);
    expect(result.published.status).toBe("skipped");
    expect(existsSync(outPath)).toBe(false);
  });

  it("runs the Common lane with no provider key at all, spending no upstream call", async () => {
    const outPath = temporaryOutPath();
    let fetched = 0;
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--with-common"],
      env: {},
      nowMs: NOW_MS,
      fetchImpl: (async () => {
        fetched += 1;
        return ticketmasterResponse();
      }) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(fetched).toBe(0);
    expect(result.provider.status).toBe("not-configured");
    expect(commonRan).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("resolves a venueId only when the CLI injects a venue index", async () => {
    const outPath = temporaryOutPath();
    await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--with-common"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => ticketmasterResponse()) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows[0].venueId).toBeUndefined();
    expect(written.rows[0].placeName).toEqual(expect.any(String));
  });
});

describe("the Skiddle fence holds the WRITE lane shut too", () => {
  const NOW_MS = Date.parse("2026-08-16T09:00:00.000Z");

  it("fetches and writes no Skiddle row while the logo asset is absent, key present", async () => {
    // The fence is the undischarged licence obligation, not the missing key, so
    // the day SKIDDLE_API_KEY lands must not be the day Skiddle rows reach a
    // reader. Both lanes read one predicate, so they cannot disagree.
    expect(skiddleLaneFenced()).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "events-refresh-skiddle-"));
    temporaryDirs.push(dir);
    const outPath = join(dir, "events_london.json");
    const asked: string[] = [];
    const lines: string[] = [];

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "tm-key", SKIDDLE_API_KEY: "sk-key" },
      nowMs: NOW_MS,
      fetchImpl: (async (url: URL | string) => {
        asked.push(String(url));
        return new Response(JSON.stringify({ _embedded: { events: [tmTheatre] } }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: (message: string) => lines.push(message),
      logError: (message: string) => lines.push(message),
    });

    expect(result.provider.status).toBe("wrote");
    // No Skiddle request was ever made.
    expect(asked.some((url) => url.includes("skiddle.com"))).toBe(false);
    // And no Skiddle row was written.
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(
      written.rows.filter(
        (row: { source: { label: string } }) => row.source.label.toLowerCase() === "skiddle",
      ),
    ).toEqual([]);
    const skiddleSource = written.sources.find(
      (source: { provider: string }) => source.provider === "skiddle",
    );
    expect(skiddleSource.rowsEmitted).toBe(0);
    // The refusal NAMES itself, rather than reading as an empty market.
    expect(lines.some((line) => /Skiddle lane FENCED OFF/.test(line))).toBe(true);
  });
});

describe("exactly one owner of the Common crawl per run", () => {
  const NOW_MS = Date.parse("2026-08-16T09:00:00.000Z");

  function outPath() {
    const dir = mkdtempSync(join(tmpdir(), "events-refresh-owner-"));
    temporaryDirs.push(dir);
    return join(dir, "events_london.json");
  }

  it("does NOT crawl from the events lane the scheduler spawns", async () => {
    // The scheduler runs commonRefresh.mjs as its own independent lane, so the
    // events lane it spawns beside it must not crawl too - that is a polite
    // 1-req/s crawl of a third party's sitemap, and spending the budget twice
    // per run is what this flag exists to stop.
    const schedulerLanes = commandsForMode("events", false);
    const eventsLane = schedulerLanes.find((command) =>
      command.args[0].endsWith("eventsRefresh.mjs"),
    );
    const commonLanes = schedulerLanes.filter((command) =>
      command.args[0].endsWith("commonRefresh.mjs"),
    );
    expect(eventsLane).toBeDefined();
    expect(eventsLane?.args).not.toContain(WITH_COMMON_FLAG);
    expect(commonLanes).toHaveLength(1);

    let crawls = 0;
    await runEventsRefresh({
      argv: ["node", ...(eventsLane?.args.slice(1) ?? [])],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [tmTheatre] } }), {
          status: 200,
        })) as unknown as typeof fetch,
      outPath: outPath(),
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        crawls += 1;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });
    // One scheduled events run: the events lane crawls zero times, the
    // scheduler's own Common lane crawls once. One crawl in total.
    expect(crawls).toBe(0);
  });

  it("DOES crawl on the workflow path, which has only this one command", async () => {
    let crawls = 0;
    await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", WITH_COMMON_FLAG],
      env: {},
      nowMs: NOW_MS,
      fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      outPath: outPath(),
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        crawls += 1;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });
    expect(crawls).toBe(1);
  });
});

describe("the review PR is refused when the gate rejects the refreshed file", () => {
  const NOW_MS = Date.parse("2026-08-16T09:00:00.000Z");

  function outPath() {
    const dir = mkdtempSync(join(tmpdir(), "events-refresh-validate-"));
    temporaryDirs.push(dir);
    return join(dir, "events_london.json");
  }

  function keyedRun(overrides: Record<string, unknown>) {
    return runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", WITH_COMMON_FLAG, "--open-pr"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [tmTheatre] } }), {
          status: 200,
        })) as unknown as typeof fetch,
      outPath: outPath(),
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
      ...overrides,
    });
  }

  it("validates before it branches, and opens no PR when validation refuses", async () => {
    const order: string[] = [];
    const result = await keyedRun({
      validate: () => {
        order.push("validate");
        throw new Error("row 0: startsAt is not a valid ISO timestamp");
      },
      openPr: () => {
        order.push("openPr");
      },
    });
    expect(order).toEqual(["validate"]);
    expect(result.validation.status).toBe("failed");
    expect(result.ok).toBe(false);
  });

  it("blames the publish step, not the data gate, when git or gh fails", async () => {
    const result = await keyedRun({
      validate: () => {},
      openPr: () => {
        throw new Error("gh pr create: not authenticated");
      },
    });
    // The gate passed; only publishing failed, and the report says so.
    expect(result.validation.status).toBe("ran");
    expect(result.published.status).toBe("failed");
    expect(result.published.reason).toContain("gh pr create");
    expect(result.ok).toBe(false);
  });

  it("keeps a validated refresh green when Actions cannot create pull requests", async () => {
    const result = await keyedRun({
      validate: () => {},
      openPr: () => {
        const error = new Error(
          "GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)",
        );
        throw error;
      },
    });

    expect(result.validation.status).toBe("ran");
    expect(result.published.status).toBe("branch-only");
    expect(result.published.reason).toContain("cannot create pull requests");
    expect(result.ok).toBe(true);
  });

  it("reports the publish step as skipped when the gate refused first", async () => {
    const result = await keyedRun({
      validate: () => {
        throw new Error("row 0: startsAt is not a valid ISO timestamp");
      },
      openPr: () => {},
    });
    expect(result.validation.status).toBe("failed");
    expect(result.published.status).toBe("skipped");
  });

  it("opens the PR only after validation passed", async () => {
    const order: string[] = [];
    const result = await keyedRun({
      validate: () => order.push("validate"),
      openPr: () => order.push("openPr"),
    });
    expect(order).toEqual(["validate", "openPr"]);
    expect(result.validation.status).toBe("ran");
    expect(result.published.status).toBe("ran");
    expect(result.ok).toBe(true);
  });
});

describe("review publication branch and PR handoff", () => {
  const ENV = { GITHUB_REPOSITORY: "Singularityszn/pubmax", GITHUB_SERVER_URL: "https://github.com" };

  it("recognises the Actions PR-creation policy refusal", () => {
    expect(
      isPullRequestPermissionError(
        new Error("GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)"),
      ),
    ).toBe(true);
    expect(isPullRequestPermissionError(new Error("gh: not authenticated"))).toBe(false);
    expect(
      isPullRequestPermissionError(
        new Error("GraphQL: createPullRequest failed because repository input was invalid"),
      ),
    ).toBe(false);
  });

  it("updates an existing review PR from one stable branch without creating another", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "events-review-"));
    temporaryDirs.push(rootDir);
    const outPath = join(rootDir, "public/data/whats_on/events_london.json");
    mkdirSync(join(rootDir, "public/data/whats_on"), { recursive: true });
    writeFileSync(outPath, "fresh refresh", { encoding: "utf8", flag: "w" });
    const calls: Array<{ command: string; args: string[] }> = [];
    let stagedContent = "";
    const runCommand = (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "git" && args[0] === "ls-remote") return "abc\trefs/heads/whats-on-events/london\n";
      if (command === "git" && args[0] === "switch") {
        writeFileSync(outPath, "old branch content");
        return "";
      }
      if (command === "git" && args[0] === "add") stagedContent = readFileSync(outPath, "utf8");
      if (command === "gh" && args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 42, url: "https://github.com/Singularityszn/pubmax/pull/42" }]);
      }
      if (command === "git" && args[0] === "diff") throw new Error("changes are staged");
      return "";
    };

    const result = publishEventsReview({
      outPath,
      observedAt: "2026-08-22T04:00:00.000Z",
      env: ENV,
      rootDir,
      runCommand,
      log: () => {},
    });

    expect(result.status).toBe("updated");
    expect(result.branch).toBe("whats-on-events/london");
    expect(result.pullRequestUrl).toContain("/pull/42");
    expect(stagedContent).toBe("fresh refresh");
    expect(calls.some(({ command, args }) => command === "gh" && args[0] === "pr" && args[1] === "create")).toBe(false);
    expect(calls.some(({ command, args }) => command === "git" && args[0] === "push")).toBe(true);
  });

  it("hands off the stable branch when PR creation is denied", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "events-review-"));
    temporaryDirs.push(rootDir);
    const outPath = join(rootDir, "public/data/whats_on/events_london.json");
    mkdirSync(join(rootDir, "public/data/whats_on"), { recursive: true });
    writeFileSync(outPath, "fresh refresh");
    const runCommand = (command: string, args: string[]) => {
      if (command === "git" && args[0] === "ls-remote") return "";
      if (command === "git" && args[0] === "diff") throw new Error("changes are staged");
      if (command === "gh" && args[0] === "pr" && args[1] === "list") return "[]";
      if (command === "gh" && args[0] === "pr" && args[1] === "create") {
        const error = new Error(
          "GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)",
        );
        throw error;
      }
      return "";
    };

    const result = publishEventsReview({
      outPath,
      observedAt: "2026-08-22T04:00:00.000Z",
      env: ENV,
      rootDir,
      runCommand,
      log: () => {},
    });

    expect(result.status).toBe("branch-only");
    expect(result.branch).toBe("whats-on-events/london");
    expect(result.branchUrl).toBe("https://github.com/Singularityszn/pubmax/tree/whats-on-events/london");
  });
});

describe("plain-node entry point", () => {
  // `npm run refresh:events` and the local scheduler both spawn this script
  // with plain `node`, which resolves no tsconfig `@/*` alias. Vitest reaches
  // the same module through Vite, which resolves one - so a specifier
  // regression inside the Context.dev lane is invisible to every other test
  // here while it kills the CLI at module load. This is the fence for that.
  it("loads under plain node and answers for the Context.dev lane", () => {
    const childEnv = { ...process.env };
    delete childEnv.CONTEXT_DEV_API_KEY;

    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'const mod = await import("./scripts/whatson/eventsRefresh.mjs");',
          "process.stdout.write(JSON.stringify(mod.providerLaneStatus({})));",
        ].join("\n"),
      ],
      { cwd: process.cwd(), env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
    );

    expect(JSON.parse(String(stdout))).toMatchObject({
      contextdev: "not-configured",
      ticketmaster: "not-configured",
      skiddle: "not-configured",
    });
  });

  it("answers configured under plain node once the key is in the environment", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'const mod = await import("./scripts/whatson/eventsRefresh.mjs");',
          "process.stdout.write(mod.providerLaneStatus(process.env).contextdev);",
        ].join("\n"),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CONTEXT_DEV_API_KEY: "  probe-key  " },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    expect(String(stdout)).toBe("configured");
  });
});
