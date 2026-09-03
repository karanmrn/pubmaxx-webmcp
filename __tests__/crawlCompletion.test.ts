import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CRAWL_CELEBRATION_KEY,
  CRAWL_PROGRESS_KEY,
  CRAWL_QUEST_KEY,
  acknowledgeCrawlCompletion,
  completedCrawlCount,
  creditCrawlQuest,
  crawlQuestChips,
  placeQuestEventChips,
  hasCelebrationBeenShown,
  isComplete,
  markCelebrationShown,
  markCrawlComplete,
  markStopVisited,
  nextQuestTarget,
  parseProgress,
  readCrawl,
  readCrawlQuest,
  readProgress,
  shouldCelebrateCompletion,
  startCrawl,
} from "@/lib/crawlCompletion";

type WindowLike = { localStorage: Storage };

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function makeThrowingStorage(): Storage {
  const boom = () => {
    throw new Error("SecurityError: storage disabled");
  };
  return {
    length: 0,
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage;
}

function installWindow(storage: Storage): void {
  (globalThis as { window?: WindowLike }).window = { localStorage: storage };
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

beforeEach(() => {
  clearWindow();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-08T20:00:00.000Z"));
});

afterEach(() => {
  clearWindow();
  vi.useRealTimers();
});

describe("parseProgress", () => {
  it("returns empty for junk", () => {
    expect(parseProgress(null)).toEqual({ crawls: {} });
    expect(parseProgress("nope")).toEqual({ crawls: {} });
    expect(parseProgress({ crawls: "bad" })).toEqual({ crawls: {} });
  });

  it("normalises stop/visited ids and drops unknown visits", () => {
    const parsed = parseProgress({
      crawls: {
        " river-run ": {
          stopIds: [" a ", "b", "a", ""],
          visited: ["b", "ghost", " a "],
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(parsed.crawls["river-run"]).toEqual({
      stopIds: ["a", "b"],
      visited: ["b", "a"],
      startedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("startCrawl / markStopVisited / isComplete", () => {
  it("starts a crawl, tracks visits, and completes when all stops are visited", () => {
    const storage = makeMemoryStorage();
    const started = startCrawl("southbank", ["v1", "v2", "v3"], storage);
    expect(started).toMatchObject({
      stopIds: ["v1", "v2", "v3"],
      visited: [],
      startedAt: "2026-07-08T20:00:00.000Z",
    });
    expect(isComplete(started)).toBe(false);

    markStopVisited("southbank", "v1", storage);
    markStopVisited("southbank", "v2", storage);
    expect(isComplete(readCrawl("southbank", storage))).toBe(false);

    const done = markStopVisited("southbank", "v3", storage);
    expect(isComplete(done)).toBe(true);
    expect(done?.completedAt).toBe("2026-07-08T20:00:00.000Z");
    expect(completedCrawlCount(storage)).toBe(1);
  });

  it("ignores visits for unknown crawls or off-route venues", () => {
    const storage = makeMemoryStorage();
    expect(markStopVisited("missing", "v1", storage)).toBeNull();
    startCrawl("loop", ["v1"], storage);
    const same = markStopVisited("loop", "other", storage);
    expect(same?.visited).toEqual([]);
  });

  it("markCrawlComplete fills every stop", () => {
    const storage = makeMemoryStorage();
    startCrawl("quick", ["a", "b"], storage);
    const done = markCrawlComplete("quick", storage);
    expect(done?.visited).toEqual(["a", "b"]);
    expect(isComplete(done)).toBe(true);
  });

  it("restarting a crawl clears prior progress", () => {
    const storage = makeMemoryStorage();
    startCrawl("again", ["a", "b"], storage);
    markStopVisited("again", "a", storage);
    const restarted = startCrawl("again", ["a", "b", "c"], storage);
    expect(restarted?.visited).toEqual([]);
    expect(restarted?.stopIds).toEqual(["a", "b", "c"]);
    expect(restarted?.completedAt).toBeUndefined();
  });

  it("rejects blank ids / empty stop lists", () => {
    const storage = makeMemoryStorage();
    expect(startCrawl("", ["a"], storage)).toBeNull();
    expect(startCrawl("x", [], storage)).toBeNull();
  });
});

describe("storage seam", () => {
  it("reads from window.localStorage when no storage arg is passed", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    startCrawl("windowed", ["p1", "p2"]);
    expect(readProgress().crawls.windowed?.stopIds).toEqual(["p1", "p2"]);
    expect(storage.getItem(CRAWL_PROGRESS_KEY)).toContain("windowed");
  });

  it("fail-softs when storage throws or window is missing", () => {
    expect(readProgress(null)).toEqual({ crawls: {} });
    // No storage → still returns the in-memory entry (write is a no-op).
    expect(startCrawl("x", ["a"], null)).toMatchObject({ stopIds: ["a"], visited: [] });
    expect(startCrawl("y", ["a"], makeThrowingStorage())).toMatchObject({
      stopIds: ["a"],
    });
    // No window → default storage resolves to null.
    expect(readProgress()).toEqual({ crawls: {} });
  });
});

describe("Wave G2 celebration eligibility + one-shot flag", () => {
  it("is not eligible until the crawl is complete", () => {
    const storage = makeMemoryStorage();
    startCrawl("river", ["a", "b"], storage);
    markStopVisited("river", "a", storage);
    expect(shouldCelebrateCompletion("river", null, storage)).toBe(false);
    expect(hasCelebrationBeenShown("river", storage)).toBe(false);
  });

  it("becomes eligible on the transition to complete, then one-shot after claim", () => {
    const storage = makeMemoryStorage();
    startCrawl("river", ["a", "b"], storage);
    markStopVisited("river", "a", storage);
    const done = markStopVisited("river", "b", storage);
    expect(isComplete(done)).toBe(true);
    expect(shouldCelebrateCompletion("river", done, storage)).toBe(true);

    markCelebrationShown("river", storage);
    expect(hasCelebrationBeenShown("river", storage)).toBe(true);
    expect(shouldCelebrateCompletion("river", done, storage)).toBe(false);
    // Remount / second claim does not re-arm.
    markCelebrationShown("river", storage);
    expect(shouldCelebrateCompletion("river", done, storage)).toBe(false);
    expect(storage.getItem(CRAWL_CELEBRATION_KEY)).toContain("river");
  });

  it("acknowledgeCrawlCompletion celebrates once and credits quest + Place story", () => {
    const storage = makeMemoryStorage();
    startCrawl("fleet-street-writers", ["a", "b"], storage);
    markCrawlComplete("fleet-street-writers", storage);

    const first = acknowledgeCrawlCompletion(
      "fleet-street-writers",
      { placeStoryBandId: "fleet-street-writers" },
      storage,
    );
    expect(first.celebrate).toBe(true);
    expect(first.quest.completedCrawlIds).toEqual(["fleet-street-writers"]);
    expect(first.quest.placeStoryBandIds).toEqual(["fleet-street-writers"]);

    const second = acknowledgeCrawlCompletion(
      "fleet-street-writers",
      { placeStoryBandId: "fleet-street-writers" },
      storage,
    );
    expect(second.celebrate).toBe(false);
    expect(second.quest.completedCrawlIds).toEqual(["fleet-street-writers"]);
    expect(crawlQuestChips(storage).map((c) => c.id)).toEqual([
      "crawl-complete",
      "place-story-crawl",
    ]);
    expect(crawlQuestChips(storage)).toEqual([
      {
        id: "crawl-complete",
        current: 1,
        target: 3,
        label: "Crawl walked",
      },
      {
        id: "place-story-crawl",
        current: 1,
        target: 3,
        label: "Place story walked",
      },
    ]);
  });

  it("crawlQuestChips uses the next milestone so target !== current", () => {
    const storage = makeMemoryStorage();
    creditCrawlQuest("a", undefined, storage);
    expect(crawlQuestChips(storage)[0]).toMatchObject({ current: 1, target: 3 });
    creditCrawlQuest("b", undefined, storage);
    creditCrawlQuest("c", undefined, storage);
    expect(crawlQuestChips(storage)[0]).toMatchObject({ current: 3, target: 5 });
  });

  it("nextQuestTarget steps through tiers then current+1", () => {
    expect(nextQuestTarget(0)).toBe(1);
    expect(nextQuestTarget(1)).toBe(3);
    expect(nextQuestTarget(2)).toBe(3);
    expect(nextQuestTarget(5)).toBe(10);
    expect(nextQuestTarget(25)).toBe(26);
  });

  it("creditCrawlQuest is idempotent and skips Place story when unset", () => {
    const storage = makeMemoryStorage();
    creditCrawlQuest("hand-built", { nowIso: "2026-07-09T12:00:00.000Z" }, storage);
    creditCrawlQuest("hand-built", { placeStoryBandId: "  ", nowIso: "2026-07-09T12:00:00.000Z" }, storage);
    const quest = readCrawlQuest(storage);
    expect(quest.completedCrawlIds).toEqual(["hand-built"]);
    expect(quest.placeStoryBandIds).toEqual([]);
    expect(quest.completedAtByCrawlId?.["hand-built"]).toBe("2026-07-09T12:00:00.000Z");
    creditCrawlQuest(
      "hand-built",
      { placeStoryBandId: "river-history", nowIso: "2026-07-09T12:00:00.000Z" },
      storage,
    );
    creditCrawlQuest(
      "hand-built",
      { placeStoryBandId: "river-history", nowIso: "2026-07-09T12:00:00.000Z" },
      storage,
    );
    expect(readCrawlQuest(storage).placeStoryBandIds).toEqual(["river-history"]);
    expect(storage.getItem(CRAWL_QUEST_KEY)).toContain("river-history");
  });

  it("creditCrawlQuest preserves the first completion timestamp on repeat credits", () => {
    const storage = makeMemoryStorage();
    creditCrawlQuest("hand-built", { nowIso: "2026-07-01T12:00:00.000Z" }, storage);
    creditCrawlQuest("hand-built", { nowIso: "2026-07-09T18:00:00.000Z" }, storage);
    expect(readCrawlQuest(storage).completedAtByCrawlId?.["hand-built"]).toBe(
      "2026-07-01T12:00:00.000Z",
    );
  });

  it("placeQuestEventChips counts breadth quests inside a weekly window (Wave H3)", () => {
    const storage = makeMemoryStorage();
    const now = Date.parse("2026-07-09T18:00:00.000Z");
    creditCrawlQuest(
      "riverside-heritage",
      { placeStoryBandId: "thames-industrial", nowIso: "2026-07-08T12:00:00.000Z" },
      storage,
    );
    creditCrawlQuest(
      "bankside-riverside",
      { placeStoryBandId: "river-history", nowIso: "2026-07-09T10:00:00.000Z" },
      storage,
    );
    // Outside the week — must not count.
    creditCrawlQuest(
      "old-crawl",
      { placeStoryBandId: "markets-theatre", nowIso: "2026-06-01T12:00:00.000Z" },
      storage,
    );
    const chips = placeQuestEventChips(now, storage);
    const crawlWeek = chips.find((c) => c.id === "quest-crawl-week");
    const storiesWeek = chips.find((c) => c.id === "quest-stories-week");
    expect(crawlWeek).toMatchObject({ current: 1, target: 1, windowLabel: "this week" });
    expect(storiesWeek).toMatchObject({ current: 2, target: 2, windowLabel: "this week" });
  });

  it("acknowledge does not celebrate incomplete crawls", () => {
    const storage = makeMemoryStorage();
    startCrawl("half", ["a", "b"], storage);
    const ack = acknowledgeCrawlCompletion("half", undefined, storage);
    expect(ack.celebrate).toBe(false);
    expect(ack.quest.completedCrawlIds).toEqual([]);
    expect(hasCelebrationBeenShown("half", storage)).toBe(false);
  });
});
