import { afterEach, describe, expect, it, vi } from "vitest";

import { createLiveEventsProvider } from "@/lib/events/liveProvider";
import {
  EVENT_DROP_REASONS,
  emptyEventDrops,
  mergeEventDrops,
} from "@/lib/whatson/eventNormalise.mjs";

const ENV_VAR = "DROP_LOG_PROBE_KEY";
const NOW = Date.parse("2026-08-16T18:00:00.000Z");

afterEach(() => {
  delete process.env[ENV_VAR];
  vi.restoreAllMocks();
});

function providerReportingOneDropPerReason() {
  process.env[ENV_VAR] = "probe-key";
  const dropped = mergeEventDrops(emptyEventDrops(), {
    ...emptyEventDrops(),
    ...Object.fromEntries(EVENT_DROP_REASONS.map((reason) => [reason, 1])),
    total: EVENT_DROP_REASONS.length,
  });
  return createLiveEventsProvider({
    name: "DropProbe",
    envVar: ENV_VAR,
    upstreamLabel: "Drop probe",
    buildUrl: () => new URL("https://example.com/events"),
    normalise: () => ({ rows: [], dropped }),
  });
}

type LogRecord = Record<string, unknown>;

function dropLogRecords(lines: unknown[][]): LogRecord[] {
  const records: LogRecord[] = [];
  for (const [line] of lines) {
    let parsed: LogRecord | null = null;
    try {
      parsed = JSON.parse(String(line)) as LogRecord;
    } catch {
      parsed = null;
    }
    if (parsed?.event === "out.provider_drops") records.push(parsed);
  }
  return records;
}

describe("live provider drop log", () => {
  it("names EVERY drop reason the shared vocabulary holds", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = providerReportingOneDropPerReason();

    await provider.fetchTonight({
      now: NOW,
      fetchImpl: (async () =>
        new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });

    const [record] = dropLogRecords(consoleSpy.mock.calls);
    expect(record).toBeDefined();
    expect(record?.total).toBe(EVENT_DROP_REASONS.length);
    for (const reason of EVENT_DROP_REASONS) expect(record?.[reason]).toBe(1);
  });

  it("stays quiet when a provider dropped nothing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env[ENV_VAR] = "probe-key";
    const provider = createLiveEventsProvider({
      name: "DropProbe",
      envVar: ENV_VAR,
      upstreamLabel: "Drop probe",
      buildUrl: () => new URL("https://example.com/events"),
      normalise: () => ({ rows: [], dropped: emptyEventDrops() }),
    });

    await provider.fetchTonight({
      now: NOW,
      fetchImpl: (async () =>
        new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });

    expect(dropLogRecords(consoleSpy.mock.calls)).toEqual([]);
  });

  it("bypasses its response cache when requested", async () => {
    process.env[ENV_VAR] = "probe-key";
    let fetches = 0;
    const provider = createLiveEventsProvider({
      name: "CacheProbe",
      envVar: ENV_VAR,
      upstreamLabel: "Cache probe",
      buildUrl: () => new URL("https://example.com/events"),
      normalise: (_payload, opts) => ({
        rows: [
          {
            id: `event-${opts.observedAt}`,
            placeName: "Jazz Cafe",
            kind: "event",
            startsAt: "2026-08-16T19:00:00.000Z",
            endsAt: "2026-08-16T22:00:00.000Z",
            title: "Live jazz",
            source: { label: "CacheProbe", url: "https://example.com/events" },
            observedAt: opts.observedAt,
            confidence: "listed",
          },
        ],
      }),
    });
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    await provider.fetchTonight({ now: NOW, fetchImpl });
    await provider.fetchTonight({ now: NOW + 1_000, fetchImpl, cache: "bypass" });

    expect(fetches).toBe(2);
  });
});
