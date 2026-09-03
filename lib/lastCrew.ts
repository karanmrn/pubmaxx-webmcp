// Persistent "usual lot" roster — Sort My Night P1 foundation.
// Client-only localStorage MVP: remember the names from the last plan crew
// so the next /plan can one-tap re-invite them via the existing share link.
// No durable server table yet; never invents members.

import { cleanCrewName, CREW_NAME_MAX } from "@/lib/crew";

export const LAST_CREW_STORAGE_KEY = "pubmax-last-crew-v1";
export const LAST_CREW_MAX_NAMES = 12;

export type LastCrew = {
  names: string[];
  /** ISO timestamp when the roster was last written. */
  savedAt: string;
  /** Plan that produced this roster, when known. */
  sourcePlanId?: string;
};

let lastCrewSnapshotRaw: string | null | undefined;
let lastCrewSnapshot: LastCrew | null = null;

/** Closed `source` values for the `next_night_committed` analytics event. */
export type NextNightCommittedSource = "crew-reinvite" | "completed_plan";

function normalizeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = cleanCrewName(entry);
    if (!name || name.length > CREW_NAME_MAX) continue;
    const key = name.toLocaleLowerCase("en-GB");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= LAST_CREW_MAX_NAMES) break;
  }
  return names;
}

/** Parse a stored payload; returns null when empty or malformed. */
export function parseLastCrew(raw: unknown): LastCrew | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const names = normalizeNames(record.names);
  // A "usual lot" is a crew — solo nights are not persisted as a roster.
  if (names.length < 2) return null;
  const savedAt =
    typeof record.savedAt === "string" && record.savedAt.trim()
      ? record.savedAt
      : new Date(0).toISOString();
  const sourcePlanId =
    typeof record.sourcePlanId === "string" && record.sourcePlanId.trim()
      ? record.sourcePlanId.trim()
      : undefined;
  const crew: LastCrew = { names, savedAt };
  if (sourcePlanId) crew.sourcePlanId = sourcePlanId;
  return crew;
}

/** Read the usual lot from localStorage (browser only). */
export function readLastCrew(): LastCrew | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_CREW_STORAGE_KEY);
    if (raw === lastCrewSnapshotRaw) return lastCrewSnapshot;
    let next: LastCrew | null = null;
    if (raw) {
      try {
        next = parseLastCrew(JSON.parse(raw) as unknown);
      } catch {
        next = null;
      }
    }
    lastCrewSnapshotRaw = raw;
    lastCrewSnapshot = next;
    return next;
  } catch {
    return null;
  }
}

/** Subscribe to cross-tab localStorage updates of the usual-lot roster. */
export function subscribeLastCrew(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: StorageEvent) => {
    if (event.key === LAST_CREW_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/**
 * Remember a plan's crew names as the usual lot. Requires at least two names
 * (solo nights are not a "crew"). Fail-soft when storage is blocked.
 */
export function rememberLastCrew(
  names: readonly string[],
  sourcePlanId?: string,
): LastCrew | null {
  const crew = parseLastCrew({
    names,
    savedAt: new Date().toISOString(),
    sourcePlanId,
  });
  if (!crew || crew.names.length < 2) return null;
  if (typeof window === "undefined") return crew;
  try {
    window.localStorage.setItem(LAST_CREW_STORAGE_KEY, JSON.stringify(crew));
  } catch {
    // Private mode / quota — planning still works without persistence.
  }
  return crew;
}

/** Whole calendar days since the usual lot was last saved (0 when unknown). */
export function lastCrewWindowDays(crew: LastCrew, now = new Date()): number {
  const saved = Date.parse(crew.savedAt);
  if (!Number.isFinite(saved)) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((now.getTime() - saved) / msPerDay));
}

/** Allow-listed props for `next_night_committed` — no names, no free text. */
export function nextNightCommittedProps(
  source: NextNightCommittedSource,
  crew: LastCrew | null,
  now = new Date(),
): { source: NextNightCommittedSource; windowDays?: number } {
  const props: { source: NextNightCommittedSource; windowDays?: number } = { source };
  if (crew) props.windowDays = lastCrewWindowDays(crew, now);
  return props;
}

/** WhatsApp-first nudge listing the usual lot + the plan link. */
export function buildLastCrewShareText(input: {
  names: readonly string[];
  planUrl: string;
  title?: string;
}): string {
  const roster = normalizeNames([...input.names]);
  const who = roster.length > 0 ? roster.join(", ") : "the usual lot";
  const title = typeof input.title === "string" && input.title.trim()
    ? input.title.trim()
    : "Tonight";
  return `${title}: ${who}. I'm in: ${input.planUrl}`;
}
