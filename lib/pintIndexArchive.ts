// Dated monthly editions of the public London Pint Index.
//
// A citation to a live page rots: the figures move under whoever cited them.
// So every closed calendar month gets its own file, its own URL and its own
// structured data, and that file is never rewritten in silence. The rules that
// make it citable live here as pure functions so the publishing script, the
// route and the tests all read the SAME contract:
//
//   • Only a CLOSED month may be frozen, and only one the live snapshot
//     actually assessed. A window that is still filling, one the source
//     snapshot never covered, or one that predates the public Index itself is
//     not a fact yet.
//   • A month file is written once. A genuine correction is an APPEND: the
//     revision rises, the correction carries its note, its date and the hash
//     of the observations it replaced, and the reader sees all of it.
//   • The hash is over a canonical form of the observations, so re-ordering or
//     re-formatting the file cannot pass as "unchanged" and a real edit cannot
//     pass as a reformat.
//
// Times are UTC end to end. A pint observed at 00:30 London on 1 July belongs
// to July in the published window and in the hash, wherever the build runs.

import {
  validatePintIndexSnapshot,
  type PintIndexObservation,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { canonicalObservationsPayload as canonicalPayload } from "@/lib/pintIndexCanonical.mjs";

/** `YYYY-MM`, the id of a monthly edition and the last segment of its URL. */
export const PINT_INDEX_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * The first month the public Index existed to assess, declared rather than
 * inferred. The live snapshot's own coverage window is optional and is null
 * whenever nothing has qualified yet, so it cannot be the floor: without this
 * constant an empty snapshot would let any long-past month be frozen into a
 * zero-observation edition, and "nothing cleared the bar in March 2019" is a
 * citable claim about a window the Index never looked at. A genuinely assessed
 * month with no qualifying price still publishes, which is a different thing.
 */
export const PINT_INDEX_PUBLIC_START_MONTH = "2026-06";

export type PintIndexCorrection = {
  /** When the correction was published. */
  issuedAt: string;
  /** What was wrong and what changed, in one plain sentence. */
  note: string;
  /** The revision this correction replaced (1 for the first publication). */
  previousRevision: number;
  /** Canonical observations hash of the replaced revision. */
  previousObservationsSha256: string;
};

export type PintIndexArchiveMeta = {
  month: string;
  /** 1 on first publication, then +1 per correction. */
  revision: number;
  /** When this revision was published. */
  publishedAt: string;
  /** Snapshot id of the live index this edition was frozen from. */
  sourceSnapshotId: string;
  /** Hash of the canonical observations in THIS revision. */
  observationsSha256: string;
  corrections: PintIndexCorrection[];
};

export type ArchivedPintIndexSnapshot = PintIndexSnapshot & { archive: PintIndexArchiveMeta };

/** A hex sha256 of a UTF-8 string. Injected so this module stays runtime-free. */
export type Sha256 = (input: string) => string;

const HEX_64 = /^[0-9a-f]{64}$/;

export function isPintIndexMonth(value: unknown): value is string {
  return typeof value === "string" && PINT_INDEX_MONTH_PATTERN.test(value);
}

function monthParts(month: string): { year: number; monthIndex: number } {
  return { year: Number(month.slice(0, 4)), monthIndex: Number(month.slice(5, 7)) - 1 };
}

/** The UTC instants a calendar month opens and closes on, inclusive. */
export function pintIndexMonthWindow(month: string): { start: string; end: string } {
  const { year, monthIndex } = monthParts(month);
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - 1).toISOString(),
  };
}

/** `2026-06-01/2026-06-30`: the schema.org temporalCoverage for the month. */
export function pintIndexMonthTemporalCoverage(month: string): string {
  const window = pintIndexMonthWindow(month);
  return `${window.start.slice(0, 10)}/${window.end.slice(0, 10)}`;
}

/**
 * The day a month closes, anchored at noon UTC so no timezone can push it onto
 * the next date. The window itself ends at 23:59:59.999Z, which reads as 1
 * August in London (BST) and would print a closing day the month never had.
 */
export function pintIndexMonthCloseDay(month: string): string {
  return `${pintIndexMonthWindow(month).end.slice(0, 10)}T12:00:00.000Z`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "June 2026". Fixed to UTC so a US-locale build cannot stamp "6/2026". */
export function pintIndexMonthLabel(month: string): string {
  return MONTH_LABEL.format(new Date(pintIndexMonthWindow(month).start));
}

const LONDON_MONTH = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Europe/London",
});

/**
 * The `YYYY-MM` an instant falls in on the LONDON calendar. The one exception
 * to the UTC rule above, and only for the month a reader is currently living
 * in: every date printed beside it is formatted in Europe/London, so deriving
 * that month in UTC would, for the first hour of each BST month, name a month
 * that has already closed as the one still filling.
 */
export function londonMonthOf(date: Date): string {
  const parts = LONDON_MONTH.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

/** The `YYYY-MM` an ISO instant falls in, UTC. Null when it is not a date. */
export function pintIndexMonthOf(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 7);
}

/**
 * The canonical string the integrity hash is taken over. The reduction itself
 * lives in lib/pintIndexCanonical.mjs so the build gate in
 * scripts/validate-data.mjs runs the SAME code rather than a copy of it: a
 * second implementation that drifts by one character accuses a correctly
 * published edition of having been rewritten.
 */
export function canonicalObservationsPayload(observations: readonly PintIndexObservation[]): string {
  return canonicalPayload(observations);
}

export function observationsHash(observations: readonly PintIndexObservation[], sha256: Sha256): string {
  return sha256(canonicalObservationsPayload(observations));
}

export type PintIndexArchiveValidation =
  | { ok: true; archive: ArchivedPintIndexSnapshot }
  | { ok: false; errors: string[] };

/**
 * A stored monthly edition is valid only when it is a valid public snapshot
 * AND its archive contract holds: the month matches the file it was loaded as,
 * the window is exactly that month, every observation sits inside it, the
 * revision equals the correction count, and the stored hash matches the
 * observations actually present.
 */
export function validateArchivedPintIndexSnapshot(
  value: unknown,
  options: { month?: string; sha256: Sha256 },
): PintIndexArchiveValidation {
  const base = validatePintIndexSnapshot(value);
  if (!base.ok) return base;
  const snapshot = base.snapshot as ArchivedPintIndexSnapshot;
  const errors: string[] = [];
  const archive = (snapshot as { archive?: unknown }).archive;

  if (typeof archive !== "object" || archive === null || Array.isArray(archive)) {
    return { ok: false, errors: ["archive metadata is missing"] };
  }
  const meta = archive as Record<string, unknown>;
  const month = meta.month;

  if (!isPintIndexMonth(month)) {
    errors.push("archive.month must be YYYY-MM");
  } else if (options.month && options.month !== month) {
    errors.push(`archive.month ${month} does not match the edition it is stored as (${options.month})`);
  }

  if (typeof meta.sourceSnapshotId !== "string" || !meta.sourceSnapshotId.trim()) {
    errors.push("archive.sourceSnapshotId is required");
  }
  if (!Number.isFinite(Date.parse(String(meta.publishedAt)))) {
    errors.push("archive.publishedAt must be an ISO date");
  }

  const corrections = Array.isArray(meta.corrections) ? meta.corrections : null;
  if (!corrections) errors.push("archive.corrections must be an array");
  if (!Number.isInteger(meta.revision) || Number(meta.revision) < 1) {
    errors.push("archive.revision must be a positive integer");
  } else if (corrections && Number(meta.revision) !== corrections.length + 1) {
    errors.push("archive.revision must equal the number of corrections plus one");
  }

  let previousIssuedAt = 0;
  corrections?.forEach((correction, index) => {
    const row = correction as Record<string, unknown>;
    const issuedAt = Date.parse(String(row.issuedAt));
    if (!Number.isFinite(issuedAt)) errors.push(`correction ${index} issuedAt must be an ISO date`);
    else if (issuedAt < previousIssuedAt) errors.push(`correction ${index} is out of order`);
    else previousIssuedAt = issuedAt;
    if (typeof row.note !== "string" || !row.note.trim()) errors.push(`correction ${index} needs a note`);
    if (row.previousRevision !== index + 1) errors.push(`correction ${index} must replace revision ${index + 1}`);
    if (typeof row.previousObservationsSha256 !== "string" || !HEX_64.test(row.previousObservationsSha256)) {
      errors.push(`correction ${index} must carry the replaced revision's observations hash`);
    }
  });

  if (isPintIndexMonth(month)) {
    const window = pintIndexMonthWindow(month);
    if (snapshot.observationWindow?.start !== window.start || snapshot.observationWindow?.end !== window.end) {
      errors.push("observationWindow must be exactly the archived month");
    }
    for (const [index, observation] of snapshot.observations.entries()) {
      if (pintIndexMonthOf(observation.observedAt) !== month) {
        errors.push(`observation ${index} was not observed in ${month}`);
      }
    }
  }

  const hash = typeof meta.observationsSha256 === "string" ? meta.observationsSha256 : "";
  if (!HEX_64.test(hash)) errors.push("archive.observationsSha256 must be a hex sha256");
  else if (hash !== observationsHash(snapshot.observations, options.sha256)) {
    errors.push("archive.observationsSha256 does not match the published observations");
  }

  return errors.length ? { ok: false, errors } : { ok: true, archive: snapshot };
}

/**
 * Why this month may not hold an edition AT ALL. These are the rules that can
 * never stop being true of a month once they are true: it is a real month, it
 * has closed, and the public Index existed to assess it. Nothing here reads the
 * live snapshot, which is what makes it safe to apply to an edition that is
 * already frozen. A correction to a published month is checked against this
 * alone, so a live window that moves on cannot strand a published month with no
 * way to correct it, and cannot turn a fence red against a write-once file.
 */
export function monthPublishFloorBlocker(month: string, now: Date): string | null {
  if (!isPintIndexMonth(month)) return `${month} is not a YYYY-MM month`;
  if (Date.parse(pintIndexMonthWindow(month).end) >= now.getTime()) return `${month} has not closed yet`;
  if (month < PINT_INDEX_PUBLIC_START_MONTH) {
    return `${month} is before the public Index began covering prices in ${PINT_INDEX_PUBLIC_START_MONTH}`;
  }
  return null;
}

/**
 * Why a month cannot be frozen for the FIRST time yet. Null means it can. The
 * floor above, plus the questions only the live snapshot can answer: it has to
 * have been generated after the month closed, and to have been looking at that
 * month while it ran.
 */
export function monthPublishBlocker(
  month: string,
  snapshot: PintIndexSnapshot,
  now: Date,
): string | null {
  const floor = monthPublishFloorBlocker(month, now);
  if (floor) return floor;
  const window = pintIndexMonthWindow(month);
  const closesAt = Date.parse(window.end);
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (closesAt > generatedAt) return `${month} closes after the live index was generated`;
  const coverage = snapshot.observationWindow;
  if (coverage && closesAt < Date.parse(coverage.start)) {
    return `${month} ends before the live index starts covering prices`;
  }
  if (coverage && Date.parse(window.start) > Date.parse(coverage.end)) {
    return `${month} starts after the live index stops covering prices`;
  }
  return null;
}

/**
 * Freeze one closed month out of the live snapshot: the observations that were
 * valid in that window, the sources they cite, and nothing else. Pure, so the
 * same input always produces the same edition (and the same hash).
 */
export function buildArchivedMonth(options: {
  snapshot: PintIndexSnapshot;
  month: string;
  publishedAt: string;
  sha256: Sha256;
}): ArchivedPintIndexSnapshot {
  const { snapshot, month, publishedAt, sha256 } = options;
  const window = pintIndexMonthWindow(month);
  const observations = snapshot.observations.filter(
    (observation) => pintIndexMonthOf(observation.observedAt) === month,
  );
  const citedSourceIds = new Set(observations.map((observation) => observation.sourceId));
  const status: PintIndexSnapshot["status"] = observations.length === 0
    ? "empty"
    : snapshot.status === "partial" ? "partial" : "published";

  return {
    schemaVersion: 1,
    snapshotId: `london-pint-index-${month}`,
    status,
    generatedAt: snapshot.generatedAt,
    observationWindow: window,
    classification: snapshot.classification,
    sources: snapshot.sources.filter((source) => citedSourceIds.has(source.id)),
    observations,
    excluded: snapshot.excluded,
    archive: {
      month,
      revision: 1,
      publishedAt,
      sourceSnapshotId: snapshot.snapshotId,
      observationsSha256: observationsHash(observations, sha256),
      corrections: [],
    },
  };
}

export type ArchiveAmendment =
  | { ok: true; archive: ArchivedPintIndexSnapshot }
  | { ok: false; reason: string };

/**
 * WHICH published observation an amendment is about. A pub may be observed
 * more than once in a month (the league table keeps the latest per venue, so
 * duplicates are expected), which makes a venue id alone a claim about a pub
 * rather than about a price. Three discriminators, each needed only where the
 * one before it still leaves more than one candidate: the observed-at instant,
 * then the source id, then the position among what is left. The last two are
 * not theoretical, because an observed-at may be a bare date, so an open-data
 * lane stamping the day can put two prices for one pub on the same instant. An
 * ambiguous reference is always refused, never resolved by guessing, but it
 * must stay possible to say which one, or a wrong price becomes uncorrectable.
 */
export type ArchiveObservationRef = {
  venueId: string;
  observedAt?: string | null;
  sourceId?: string | null;
  /** 1-based, among the candidates the fields above leave, in published order. */
  ordinal?: number | null;
};

/** A published price restated at the figure its source actually carried. */
export type ArchiveRestatement = ArchiveObservationRef & { pricePence: number };

type Candidate = { observation: PintIndexObservation; index: number };

function describe(candidates: readonly Candidate[], field: (row: PintIndexObservation) => string): string {
  return candidates.map((row) => field(row.observation)).join(", ");
}

function selectObservation(
  observations: readonly PintIndexObservation[],
  ref: ArchiveObservationRef,
  month: string,
  verb: string,
): { ok: true; index: number } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  const forVenue = observations
    .map((observation, index) => ({ observation, index }))
    .filter((row) => row.observation.venueId === ref.venueId);
  if (forVenue.length === 0) {
    return refuse(`${month} publishes no observation for ${ref.venueId}, so there is nothing to ${verb}`);
  }

  let candidates = forVenue;
  const wantedAt = ref.observedAt?.trim();
  if (wantedAt) {
    const at = Date.parse(wantedAt);
    candidates = Number.isFinite(at)
      ? candidates.filter((row) => Date.parse(row.observation.observedAt) === at)
      : [];
    if (candidates.length === 0) {
      return refuse(`${month} publishes no observation for ${ref.venueId} at ${wantedAt} (it holds ${describe(forVenue, (row) => row.observedAt)}), so there is nothing to ${verb}`);
    }
  }

  const wantedSource = ref.sourceId?.trim();
  if (wantedSource) {
    const bySource = candidates.filter((row) => row.observation.sourceId === wantedSource);
    if (bySource.length === 0) {
      return refuse(`${month} publishes no observation for ${ref.venueId} citing ${wantedSource} (it cites ${describe(candidates, (row) => row.sourceId)}), so there is nothing to ${verb}`);
    }
    candidates = bySource;
  }

  if (ref.ordinal !== undefined && ref.ordinal !== null) {
    if (!Number.isInteger(ref.ordinal) || ref.ordinal < 1 || ref.ordinal > candidates.length) {
      return refuse(`${month} leaves ${candidates.length} observations for ${ref.venueId} to choose from, so the ordinal must be a whole number between 1 and ${candidates.length}`);
    }
    return { ok: true, index: candidates[ref.ordinal - 1].index };
  }

  if (candidates.length === 1) return { ok: true, index: candidates[0].index };

  // More than one candidate: refuse, and say which discriminator would settle
  // it. A collision the fields cannot separate is its own case, not a claim
  // that the observation does not exist.
  if (!wantedAt) {
    return refuse(`${month} publishes ${candidates.length} observations for ${ref.venueId} (${describe(candidates, (row) => row.observedAt)}), so name the one to ${verb} by its observed-at date`);
  }
  const sources = new Set(candidates.map((row) => row.observation.sourceId));
  if (!wantedSource && sources.size > 1) {
    return refuse(`${month} publishes ${candidates.length} observations for ${ref.venueId} at ${wantedAt} (citing ${describe(candidates, (row) => row.sourceId)}), so name the one to ${verb} by its source id`);
  }
  return refuse(`${month} publishes ${candidates.length} observations for ${ref.venueId} that these fields cannot tell apart, so name the one to ${verb} by its ordinal, 1 to ${candidates.length} in published order`);
}

/**
 * The amended observations a correction publishes, taken from the PUBLISHED
 * edition and nowhere else. A correction may not be rebuilt out of the live
 * snapshot: that snapshot's window moves on, and once it no longer covers a
 * published month the rebuild is empty, so a note about one wrong price would
 * quietly withdraw every price in the edition. Absence in a snapshot that
 * stopped looking is not evidence about the month.
 *
 * Two amendments, because a wrong price fails in two different ways. A price
 * that should never have been in the Index is WITHDRAWN, and the sources it
 * alone cited leave with it. A price that belongs but was written down wrong
 * is RESTATED at the figure its source carried, keeping the pub in its
 * borough's count rather than deleting evidence to fix a typo. Both name one
 * observation each, both are refused when they name nothing or would change
 * nothing, and neither edits history: what they produce becomes a new revision
 * beside the correction that records what it replaced.
 */
export function amendArchivedMonth(options: {
  edition: ArchivedPintIndexSnapshot;
  withdraw?: readonly ArchiveObservationRef[];
  restate?: readonly ArchiveRestatement[];
  sha256: Sha256;
}): ArchiveAmendment {
  const { edition, sha256 } = options;
  const month = edition.archive.month;
  const published = edition.observations;
  const withdrawn = new Set<number>();
  const restated = new Map<number, number>();

  for (const ref of options.withdraw ?? []) {
    const found = selectObservation(published, ref, month, "withdraw");
    if (!found.ok) return found;
    if (withdrawn.has(found.index)) {
      return { ok: false, reason: `${month} withdraws ${ref.venueId} at ${published[found.index].observedAt} twice` };
    }
    withdrawn.add(found.index);
  }

  for (const restatement of options.restate ?? []) {
    const found = selectObservation(published, restatement, month, "restate");
    if (!found.ok) return found;
    const current = published[found.index];
    if (!Number.isInteger(restatement.pricePence) || restatement.pricePence <= 0) {
      return { ok: false, reason: `restating ${restatement.venueId} at ${current.observedAt} needs a positive whole number of pence` };
    }
    if (withdrawn.has(found.index) || restated.has(found.index)) {
      return { ok: false, reason: `${month} amends ${restatement.venueId} at ${current.observedAt} twice` };
    }
    if (current.pricePence === restatement.pricePence) {
      return { ok: false, reason: `${restatement.venueId} at ${current.observedAt} already publishes ${restatement.pricePence}p` };
    }
    restated.set(found.index, restatement.pricePence);
  }

  const observations = published
    .map((observation, index) => {
      const price = restated.get(index);
      return price === undefined ? observation : { ...observation, pricePence: price };
    })
    .filter((_, index) => !withdrawn.has(index));
  const citedSourceIds = new Set(observations.map((observation) => observation.sourceId));

  return {
    ok: true,
    archive: {
      ...edition,
      status: observations.length === 0 ? "empty" : edition.status,
      sources: edition.sources.filter((source) => citedSourceIds.has(source.id)),
      observations,
      archive: {
        ...edition.archive,
        observationsSha256: observationsHash(observations, sha256),
      },
    },
  };
}

export type ArchivePublishPlan =
  | { ok: true; archive: ArchivedPintIndexSnapshot; kind: "first" | "correction" }
  | { ok: false; reason: string };

/**
 * What publishing this month may do to what is already on disk. A month with
 * no file is written. A month with a file is only ever rewritten as a NAMED
 * correction that changes something, and the correction carries the hash of
 * what it replaced, so the change is visible on the page rather than silent.
 */
export function planArchivePublish(options: {
  existing: ArchivedPintIndexSnapshot | null;
  rebuilt: ArchivedPintIndexSnapshot;
  correctionNote?: string | null;
  issuedAt: string;
  sha256: Sha256;
}): ArchivePublishPlan {
  const { existing, rebuilt, correctionNote, issuedAt } = options;
  const note = correctionNote?.trim() ?? "";

  if (!existing) {
    if (note) return { ok: false, reason: `${rebuilt.archive.month} has not been published, so there is nothing to correct` };
    return { ok: true, archive: rebuilt, kind: "first" };
  }
  if (!note) {
    return {
      ok: false,
      reason: `${existing.archive.month} is already published. A published month only changes as a named correction.`,
    };
  }
  if (existing.archive.observationsSha256 === rebuilt.archive.observationsSha256) {
    return { ok: false, reason: `${existing.archive.month} would not change, so there is nothing to correct` };
  }

  return {
    ok: true,
    kind: "correction",
    archive: {
      ...rebuilt,
      archive: {
        ...rebuilt.archive,
        revision: existing.archive.revision + 1,
        publishedAt: issuedAt,
        corrections: [
          ...existing.archive.corrections,
          {
            issuedAt,
            note,
            previousRevision: existing.archive.revision,
            previousObservationsSha256: existing.archive.observationsSha256,
          },
        ],
      },
    },
  };
}
