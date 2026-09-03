// Crawl completion tracking — a demo, localStorage-backed progress map.
//
// Marks a crawl as started, records which stops the walker has visited, and
// derives completion. Pure helpers take an optional Storage so unit tests can
// inject a Map-backed stub; browser callers omit it and use window.localStorage.
// SSR / missing storage is fail-soft (reads return empty, writes are no-ops).

import { DAY_MS } from "@/lib/dayMs";
import { safeLocalStorage } from "@/lib/safeStorage";

export const CRAWL_PROGRESS_KEY = "pubmax_crawl_progress";
/** Per-crawl one-shot celebration flags (Wave G2) — survives remounts. */
export const CRAWL_CELEBRATION_KEY = "pubmax_crawl_celebration";
/** Lightweight quest credit for crawls walked / Place stories (Wave G2). */
export const CRAWL_QUEST_KEY = "pubmax_crawl_quest";

export type CrawlProgressEntry = {
  /** Ordered stop venue ids for this crawl (snapshot at start). */
  stopIds: string[];
  /** Venue ids the walker has marked visited (subset of stopIds). */
  visited: string[];
  startedAt: string;
  /** ISO timestamp when every stop was visited, or undefined while in progress. */
  completedAt?: string;
};

export type CrawlProgressMap = {
  crawls: Record<string, CrawlProgressEntry>;
};

/** Celebration-shown map: crawl id → ISO timestamp when the prompt was claimed. */
export type CrawlCelebrationMap = {
  shown: Record<string, string>;
};

/**
 * Device-local quest credit for completing crawls (breadth of places/stories,
 * not drink volume). Idempotent per crawl id / Place-story band id.
 * Wave H3 adds completion timestamps for time-boxed place quests.
 */
export type CrawlQuestCredit = {
  completedCrawlIds: string[];
  placeStoryBandIds: string[];
  /** ISO timestamps keyed by crawl id (Wave H3 weekly quests). */
  completedAtByCrawlId?: Record<string, string>;
  /** ISO timestamps keyed by Place-story band id (Wave H3). */
  completedAtByBandId?: Record<string, string>;
};

/** Ready-to-render quest chip for NextBadgeChips / celebration copy. */
export type CrawlQuestChip = {
  id: string;
  current: number;
  target: number;
  label: string;
  /** Optional window hint, e.g. "this week" (Wave H3). */
  windowLabel?: string;
};

/** Seven-day window for place/crawl breadth quests (Wave H3). */
export const PLACE_QUEST_WEEK_MS = 7 * DAY_MS;

function emptyProgress(): CrawlProgressMap {
  return { crawls: {} };
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage === null) return null;
  if (storage) return storage;
  return safeLocalStorage();
}

function normaliseId(raw: string): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = normaliseId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Parse an untrusted stored blob into a safe progress map. Junk → empty. */
export function parseProgress(raw: unknown): CrawlProgressMap {
  if (!raw || typeof raw !== "object") return emptyProgress();
  const crawlsRaw = (raw as { crawls?: unknown }).crawls;
  if (!crawlsRaw || typeof crawlsRaw !== "object") return emptyProgress();
  const crawls: Record<string, CrawlProgressEntry> = {};
  for (const [key, value] of Object.entries(crawlsRaw as Record<string, unknown>)) {
    const id = normaliseId(key);
    if (!id || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const stopIds = Array.isArray(row.stopIds)
      ? uniqueIds(row.stopIds.map((v) => String(v)))
      : [];
    const visited = Array.isArray(row.visited)
      ? uniqueIds(row.visited.map((v) => String(v))).filter((v) => stopIds.includes(v))
      : [];
    const startedAt =
      typeof row.startedAt === "string" && row.startedAt.trim()
        ? row.startedAt
        : new Date(0).toISOString();
    const completedAt =
      typeof row.completedAt === "string" && row.completedAt.trim()
        ? row.completedAt
        : undefined;
    crawls[id] = {
      stopIds,
      visited,
      startedAt,
      ...(completedAt ? { completedAt } : {}),
    };
  }
  return { crawls };
}

/** Read the full progress map from storage (or empty when unavailable). */
export function readProgress(storage?: Storage | null): CrawlProgressMap {
  const store = resolveStorage(storage);
  if (!store) return emptyProgress();
  try {
    const raw = store.getItem(CRAWL_PROGRESS_KEY);
    if (!raw) return emptyProgress();
    return parseProgress(JSON.parse(raw) as unknown);
  } catch {
    return emptyProgress();
  }
}

function writeProgress(map: CrawlProgressMap, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(CRAWL_PROGRESS_KEY, JSON.stringify(map));
  } catch {
    // Storage full / disabled — silent degrade.
  }
}

/**
 * Start (or restart) tracking a crawl. Snapshots the stop list and clears any
 * prior visited/completed state for that id. Returns the new entry, or null
 * when the id/stops are unusable.
 */
export function startCrawl(
  slugOrId: string,
  stopIds: string[],
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  const stops = uniqueIds(stopIds);
  if (!id || stops.length === 0) return null;
  const map = readProgress(storage);
  const entry: CrawlProgressEntry = {
    stopIds: stops,
    visited: [],
    startedAt: new Date().toISOString(),
  };
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}

/**
 * Mark one stop visited on an in-progress crawl. Auto-stamps `completedAt`
 * when every stop has been visited. Returns the updated entry, or null when
 * the crawl isn't tracked / the venue isn't on the route.
 */
export function markStopVisited(
  slugOrId: string,
  venueId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  const venue = normaliseId(venueId);
  if (!id || !venue) return null;
  const map = readProgress(storage);
  const entry = map.crawls[id];
  if (!entry) return null;
  if (!entry.stopIds.includes(venue)) return entry;
  if (!entry.visited.includes(venue)) {
    entry.visited = [...entry.visited, venue];
  }
  if (isComplete(entry) && !entry.completedAt) {
    entry.completedAt = new Date().toISOString();
  }
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}

/** True when every stop in the entry has been visited. */
export function isComplete(entry: CrawlProgressEntry | null | undefined): boolean {
  if (!entry || entry.stopIds.length === 0) return false;
  const visited = new Set(entry.visited);
  return entry.stopIds.every((id) => visited.has(id));
}

/** Convenience: read one crawl's entry (or null). */
export function readCrawl(
  slugOrId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  if (!id) return null;
  return readProgress(storage).crawls[id] ?? null;
}

/** How many crawls have been fully walked (have completedAt / all stops). */
export function completedCrawlCount(storage?: Storage | null): number {
  const map = readProgress(storage);
  return Object.values(map.crawls).filter((entry) => isComplete(entry)).length;
}

/**
 * Force-mark a crawl complete (every stop visited). Useful for a "Mark complete"
 * control when the walker didn't tap each stop. Returns the entry or null.
 */
export function markCrawlComplete(
  slugOrId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  if (!id) return null;
  const map = readProgress(storage);
  const entry = map.crawls[id];
  if (!entry) return null;
  entry.visited = [...entry.stopIds];
  entry.completedAt = entry.completedAt ?? new Date().toISOString();
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}

// ── Wave G2: celebration one-shot + lightweight quest credit ─────────────────

function emptyCelebration(): CrawlCelebrationMap {
  return { shown: {} };
}

function parseCelebration(raw: unknown): CrawlCelebrationMap {
  if (!raw || typeof raw !== "object") return emptyCelebration();
  const shownRaw = (raw as { shown?: unknown }).shown;
  if (!shownRaw || typeof shownRaw !== "object") return emptyCelebration();
  const shown: Record<string, string> = {};
  for (const [key, value] of Object.entries(shownRaw as Record<string, unknown>)) {
    const id = normaliseId(key);
    if (!id || typeof value !== "string" || !value.trim()) continue;
    shown[id] = value.trim();
  }
  return { shown };
}

function emptyQuest(): CrawlQuestCredit {
  return {
    completedCrawlIds: [],
    placeStoryBandIds: [],
    completedAtByCrawlId: {},
    completedAtByBandId: {},
  };
}

function parseTimestampMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = normaliseId(key);
    if (!id || typeof value !== "string" || !value.trim()) continue;
    out[id] = value.trim();
  }
  return out;
}

function parseQuest(raw: unknown): CrawlQuestCredit {
  if (!raw || typeof raw !== "object") return emptyQuest();
  const row = raw as {
    completedCrawlIds?: unknown;
    placeStoryBandIds?: unknown;
    completedAtByCrawlId?: unknown;
    completedAtByBandId?: unknown;
  };
  return {
    completedCrawlIds: Array.isArray(row.completedCrawlIds)
      ? uniqueIds(row.completedCrawlIds.map((v) => String(v)))
      : [],
    placeStoryBandIds: Array.isArray(row.placeStoryBandIds)
      ? uniqueIds(row.placeStoryBandIds.map((v) => String(v)))
      : [],
    completedAtByCrawlId: parseTimestampMap(row.completedAtByCrawlId),
    completedAtByBandId: parseTimestampMap(row.completedAtByBandId),
  };
}

function readJsonKey(key: string, storage?: Storage | null): unknown {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJsonKey(key: string, value: unknown, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / disabled — silent degrade.
  }
}

/** Read which crawl completions have already shown the celebration prompt. */
export function readCelebration(storage?: Storage | null): CrawlCelebrationMap {
  return parseCelebration(readJsonKey(CRAWL_CELEBRATION_KEY, storage));
}

/** True when the one-shot celebration for this crawl has already been claimed. */
export function hasCelebrationBeenShown(
  slugOrId: string,
  storage?: Storage | null,
): boolean {
  const id = normaliseId(slugOrId);
  if (!id) return false;
  return Boolean(readCelebration(storage).shown[id]);
}

/**
 * Persist that the celebration UI was shown for this crawl. Idempotent.
 * Call when the prompt is displayed so remounts do not spam it.
 */
export function markCelebrationShown(
  slugOrId: string,
  storage?: Storage | null,
): void {
  const id = normaliseId(slugOrId);
  if (!id) return;
  const map = readCelebration(storage);
  if (map.shown[id]) return;
  map.shown[id] = new Date().toISOString();
  writeJsonKey(CRAWL_CELEBRATION_KEY, map, storage);
}

/**
 * Celebration eligibility: crawl is complete AND the one-shot flag is unset.
 * Does not mutate storage — pair with `markCelebrationShown` when displaying.
 */
export function shouldCelebrateCompletion(
  slugOrId: string,
  entry?: CrawlProgressEntry | null,
  storage?: Storage | null,
): boolean {
  const id = normaliseId(slugOrId);
  if (!id) return false;
  const progress = entry ?? readCrawl(id, storage);
  if (!isComplete(progress)) return false;
  return !hasCelebrationBeenShown(id, storage);
}

/** Read device-local crawl / Place-story quest credit. */
export function readCrawlQuest(storage?: Storage | null): CrawlQuestCredit {
  return parseQuest(readJsonKey(CRAWL_QUEST_KEY, storage));
}

/**
 * Credit a completed crawl toward lightweight quest chips. Prefer breadth:
 * distinct crawl ids + optional Place-story band ids. Idempotent per id.
 */
export function creditCrawlQuest(
  slugOrId: string,
  options?: { placeStoryBandId?: string | null; nowIso?: string },
  storage?: Storage | null,
): CrawlQuestCredit {
  const id = normaliseId(slugOrId);
  const band = normaliseId(options?.placeStoryBandId ?? "");
  const quest = readCrawlQuest(storage);
  if (!id) return quest;
  const nowIso = options?.nowIso?.trim() || new Date().toISOString();
  if (!quest.completedCrawlIds.includes(id)) {
    quest.completedCrawlIds = [...quest.completedCrawlIds, id];
    quest.completedAtByCrawlId = { ...(quest.completedAtByCrawlId ?? {}), [id]: nowIso };
  }
  if (band) {
    if (!quest.placeStoryBandIds.includes(band)) {
      quest.placeStoryBandIds = [...quest.placeStoryBandIds, band];
      quest.completedAtByBandId = { ...(quest.completedAtByBandId ?? {}), [band]: nowIso };
    }
  }
  writeJsonKey(CRAWL_QUEST_KEY, quest, storage);
  return quest;
}

function countInWindow(
  timestamps: Record<string, string> | undefined,
  nowMs: number,
  windowMs: number,
): number {
  if (!timestamps) return 0;
  let n = 0;
  for (const iso of Object.values(timestamps)) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (nowMs - t <= windowMs && nowMs - t >= 0) n += 1;
  }
  return n;
}

/**
 * Time-boxed place/crawl breadth quests (Wave H3 / IDEAS B2-lite).
 * Never rewards drink volume — only crawls walked and Place stories explored.
 */
export function placeQuestEventChips(
  nowMs: number = Date.now(),
  storage?: Storage | null,
): CrawlQuestChip[] {
  const quest = readCrawlQuest(storage);
  const crawlsThisWeek = countInWindow(
    quest.completedAtByCrawlId,
    nowMs,
    PLACE_QUEST_WEEK_MS,
  );
  const storiesThisWeek = countInWindow(
    quest.completedAtByBandId,
    nowMs,
    PLACE_QUEST_WEEK_MS,
  );
  const chips: CrawlQuestChip[] = [];
  chips.push({
    id: "quest-crawl-week",
    current: Math.min(crawlsThisWeek, 1),
    target: 1,
    label: "Finish a crawl",
    windowLabel: "this week",
  });
  chips.push({
    id: "quest-stories-week",
    current: Math.min(storiesThisWeek, 2),
    target: 2,
    label: "Walk Place stories",
    windowLabel: "this week",
  });
  return chips;
}

/**
 * Forward quest milestones for crawl / Place-story chips. Incomplete chips must
 * keep `target !== current` so NextBadgeChips can show honest `current/target`
 * progress (never a fake "done" 1/1 after the first walk).
 */
export const CRAWL_QUEST_MILESTONES = [1, 3, 5, 10, 25] as const;

/** Next milestone strictly above `current`, or `current + 1` past the last tier. */
export function nextQuestTarget(current: number): number {
  const n = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  for (const milestone of CRAWL_QUEST_MILESTONES) {
    if (n < milestone) return milestone;
  }
  return n + 1;
}

/**
 * Quest chips for passport / NextBadgeChips — crawl completion and Place-story
 * breadth. Targets are the next milestone so progress reads as forward-looking.
 * Wave H3 appends time-boxed event chips via placeQuestEventChips.
 */
export function crawlQuestChips(storage?: Storage | null): CrawlQuestChip[] {
  const quest = readCrawlQuest(storage);
  const crawls = quest.completedCrawlIds.length;
  const stories = quest.placeStoryBandIds.length;
  const chips: CrawlQuestChip[] = [];
  if (crawls > 0) {
    chips.push({
      id: "crawl-complete",
      current: crawls,
      target: nextQuestTarget(crawls),
      label: crawls === 1 ? "Crawl walked" : "Crawls walked",
    });
  }
  if (stories > 0) {
    chips.push({
      id: "place-story-crawl",
      current: stories,
      target: nextQuestTarget(stories),
      label: stories === 1 ? "Place story walked" : "Place stories walked",
    });
  }
  return chips;
}

export type AcknowledgeCrawlCompletionResult = {
  /** True only the first time a completed crawl claims the celebration. */
  celebrate: boolean;
  entry: CrawlProgressEntry | null;
  quest: CrawlQuestCredit;
};

/**
 * On crawl completion: credit quest progress and claim the one-shot celebration
 * when eligible. Safe to call on every remount — celebration returns true once.
 */
export function acknowledgeCrawlCompletion(
  slugOrId: string,
  options?: { placeStoryBandId?: string | null },
  storage?: Storage | null,
): AcknowledgeCrawlCompletionResult {
  const id = normaliseId(slugOrId);
  const entry = id ? readCrawl(id, storage) : null;
  if (!id || !isComplete(entry)) {
    return { celebrate: false, entry, quest: readCrawlQuest(storage) };
  }
  const quest = creditCrawlQuest(id, options, storage);
  const celebrate = shouldCelebrateCompletion(id, entry, storage);
  if (celebrate) {
    markCelebrationShown(id, storage);
  }
  return { celebrate, entry, quest };
}
