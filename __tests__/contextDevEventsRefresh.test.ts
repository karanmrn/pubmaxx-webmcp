import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import * as contextDev from "@/lib/contextDev";
import { runEventsRefresh } from "../scripts/whatson/eventsRefresh.mjs";

const temporaryDirs: string[] = [];
afterAll(() => {
  for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

const observedAt = "2026-08-16T09:00:00.000Z";
const nowMs = Date.parse(observedAt);

function temporaryOutPath() {
  const dir = mkdtempSync(join(tmpdir(), "contextdev-events-refresh-"));
  temporaryDirs.push(dir);
  return join(dir, "events_london.json");
}

const heldFullersRow = (id: string) => ({
  id,
  placeName: "The Dove",
  kind: "event",
  title: "Held quiz",
  source: { label: "Fuller's", url: "https://www.fullers.co.uk/pubs/the-dove/event/quiz" },
  observedAt,
  confidence: "listed",
  startsAt: "2026-08-16T19:00:00.000Z",
});

const heldGeneratedAt = "2026-08-15T09:00:00.000Z";

function writeHeldFile(outPath: string, rows: unknown[]) {
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: heldGeneratedAt, kind: "events", city: "london", rows }, null, 2),
  );
}

const ticketmasterEvent = {
  id: "tm-theatre-1",
  name: "A Night at the Playhouse",
  url: "https://www.ticketmaster.co.uk/event/tm-theatre-1",
  dates: { start: { dateTime: "2026-08-16T19:00:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Theatre" } }],
  _embedded: { venues: [{ name: "Soho Theatre" }] },
};

const answeringTicketmaster = (async () =>
  new Response(JSON.stringify({ _embedded: { events: [ticketmasterEvent] } }), {
    status: 200,
  })) as unknown as typeof fetch;

describe("eventsRefresh Context.dev lane", () => {
  it("runs with only CONTEXT_DEV_API_KEY and merges rows into the file", async () => {
    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Open mic",
            placeName: "The Counting House",
            kind: "music",
            sourceUrl: "https://www.fullers.co.uk/pubs/counting-house/event/open-mic",
            startsAt: "2026-08-16T20:00:00Z",
          },
        ],
      },
      urlsAnalyzed: ["https://www.fullers.co.uk/event-finder"],
    });

    const outPath = temporaryOutPath();
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    expect(extractSpy).toHaveBeenCalled();
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => String(row.id).startsWith("events-cd-"))).toBe(true);
    extractSpy.mockRestore();
  });

  it("refuses the write when Context.dev is the only lane and it fails", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE", message: "upstream down", retryable: true, statusCode: 503 },
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("failed");
    expect(result.provider.wrote).toBe(false);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.map((row: { id?: string }) => row.id)).toEqual(["events-cd-held"]);
    expect(written.generatedAt).toBe(heldGeneratedAt);
    extractSpy.mockRestore();
  });

  it("carries held Fuller's rows when Context.dev fails and another lane answers", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE", message: "upstream down", retryable: true, statusCode: 503 },
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: answeringTicketmaster,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => row.id === "events-cd-held")).toBe(true);
    expect(written.generatedAt).toBe(observedAt);
    extractSpy.mockRestore();
  });

  it("counts the drops of a source that yielded no rows at all", async () => {
    const extractSpy = vi.spyOn(contextDev, "extract").mockResolvedValue({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      data: {
        events: [
          {
            title: "Film screening",
            placeName: "The Dove",
            kind: "film",
            sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/film",
            startsAt: "2026-08-16T20:00:00Z",
          },
          {
            title: "Undated quiz",
            placeName: "The Dove",
            kind: "event",
            sourceUrl: "https://www.fullers.co.uk/pubs/the-dove/event/quiz",
          },
        ],
      },
      urlsAnalyzed: ["https://www.fullers.co.uk/event-finder"],
    });

    const lines: string[] = [];
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs", "--allow-empty"],
      env: { CONTEXT_DEV_API_KEY: "test-key" },
      nowMs,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
      outPath: temporaryOutPath(),
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: (line: string) => lines.push(line),
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    const wrote = lines.find((line) => line.startsWith("eventsRefresh: wrote"));
    expect(wrote).toBeDefined();
    expect(wrote).toContain("dropped 2 (noKind=1 noPlace=0 noStart=1");
    extractSpy.mockRestore();
  });

  it("carries held rows across a lane-level crash", async () => {
    const outPath = temporaryOutPath();
    writeHeldFile(outPath, [heldFullersRow("events-cd-crash-held")]);

    const extractSpy = vi.spyOn(contextDev, "extract").mockImplementation(() => {
      throw new Error("lane blew up");
    });

    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { CONTEXT_DEV_API_KEY: "test-key", TICKETMASTER_API_KEY: "tm-key" },
      nowMs,
      fetchImpl: answeringTicketmaster,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows.some((row: { id?: string }) => row.id === "events-cd-crash-held")).toBe(true);
    extractSpy.mockRestore();
  });
});
