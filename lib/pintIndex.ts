// Public London Pint Index contracts and pure derivations.
//
// This is intentionally separate from the legacy map-price dataset. A public
// Index observation is publishable only when its source and observed-at date
// survive this validator. File mtimes are never evidence of observation time.

import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";

export const LONDON_BOROUGH_NAMES = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden",
  "City of London", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney",
  "Hammersmith and Fulham", "Haringey", "Harrow", "Havering", "Hillingdon",
  "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge",
  "Richmond upon Thames", "Southwark", "Sutton", "Tower Hamlets",
  "Waltham Forest", "Wandsworth", "Westminster",
] as const;

export type LondonBoroughName = (typeof LONDON_BOROUGH_NAMES)[number];

export function boroughCode(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const BOROUGH_BY_CODE = new Map(LONDON_BOROUGH_NAMES.map((name) => [boroughCode(name), name]));

type PintIndexSourceBase = {
  id: string;
  publisher: string;
  sourceUrl: string;
  licence: string | null;
};

export type PintIndexSource = PintIndexSourceBase & (
  | { kind: "confirmed_pint_drop"; confirmationId: string; reviewState: "confirmed" }
  | { kind: "official_publisher"; publisherType: "pub" | "brewery"; officialDomain: string }
  | { kind: "open_data"; datasetName: string; licence: string }
);

export type PintIndexObservation = {
  venueId: string;
  pubName: string;
  boroughCode: string;
  boroughName: LondonBoroughName;
  pricePence: number;
  observedAt: string;
  sourceId: string;
};

export type PintIndexSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  status: "published" | "partial" | "empty";
  generatedAt: string;
  observationWindow: { start: string; end: string } | null;
  classification: {
    version: string;
    method: "point_in_polygon";
    sourceArtifact: string;
    licence: string;
  };
  sources: PintIndexSource[];
  observations: PintIndexObservation[];
  excluded: Array<{ reason: string; observationCount: number; note: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function urlHostname(value: unknown): string | null {
  if (!isPublicHttpUrl(value)) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export type PintIndexValidation =
  | { ok: true; snapshot: PintIndexSnapshot }
  | { ok: false; errors: string[] };

export function validatePintIndexSnapshot(value: unknown): PintIndexValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["snapshot must be an object"] };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof value.snapshotId !== "string" || !value.snapshotId.trim()) errors.push("snapshotId is required");
  if (!["published", "partial", "empty"].includes(String(value.status))) errors.push("status is invalid");
  if (!isIsoDate(value.generatedAt)) errors.push("generatedAt must be an ISO date");

  const window = value.observationWindow;
  if (window !== null && (!isRecord(window) || !isIsoDate(window.start) || !isIsoDate(window.end))) {
    errors.push("observationWindow must be null or contain ISO start/end dates");
  } else if (isRecord(window) && Date.parse(String(window.start)) > Date.parse(String(window.end))) {
    errors.push("observationWindow start must not follow end");
  }

  const classification = value.classification;
  if (!isRecord(classification) || classification.method !== "point_in_polygon" ||
      classification.version !== LONDON_BOROUGH_CLASSIFIER_VERSION || typeof classification.sourceArtifact !== "string" ||
      typeof classification.licence !== "string") {
    errors.push("classification contract is invalid");
  }

  const sources = Array.isArray(value.sources) ? value.sources : [];
  if (!Array.isArray(value.sources)) errors.push("sources must be an array");
  const sourceIds = new Set<string>();
  sources.forEach((source, index) => {
    if (!isRecord(source)) { errors.push(`source ${index} must be an object`); return; }
    const id = typeof source.id === "string" ? source.id : "";
    if (!id || sourceIds.has(id)) errors.push(`source ${index} has a missing or duplicate id`);
    sourceIds.add(id);
    if (!["confirmed_pint_drop", "official_publisher", "open_data"].includes(String(source.kind))) {
      errors.push(`source ${index} kind is not public-index eligible`);
    }
    if (typeof source.publisher !== "string" || !source.publisher.trim()) errors.push(`source ${index} publisher is required`);
    if (!isPublicHttpUrl(source.sourceUrl)) errors.push(`source ${index} sourceUrl must be public HTTP(S)`);
    if (source.kind === "confirmed_pint_drop" &&
        (source.reviewState !== "confirmed" || typeof source.confirmationId !== "string" || !source.confirmationId.trim())) {
      errors.push(`source ${index} Pint Drop requires a confirmed review and confirmationId`);
    }
    if (source.kind === "official_publisher") {
      const domain = typeof source.officialDomain === "string"
        ? source.officialDomain.toLowerCase().replace(/^www\./, "")
        : "";
      const hostname = urlHostname(source.sourceUrl);
      if (!["pub", "brewery"].includes(String(source.publisherType)) || !domain ||
          !hostname || (hostname !== domain && !hostname.endsWith(`.${domain}`))) {
        errors.push(`source ${index} official publisher must identify a pub/brewery domain matching sourceUrl`);
      }
    }
    if (source.kind === "open_data" &&
        ((typeof source.licence !== "string" || !source.licence.trim()) ||
         typeof source.datasetName !== "string" || !source.datasetName.trim())) {
      errors.push(`source ${index} open data requires a named dataset and licence`);
    }
  });

  const observations = Array.isArray(value.observations) ? value.observations : [];
  if (!Array.isArray(value.observations)) errors.push("observations must be an array");
  observations.forEach((observation, index) => {
    if (!isRecord(observation)) { errors.push(`observation ${index} must be an object`); return; }
    if (typeof observation.venueId !== "string" || !observation.venueId.trim()) errors.push(`observation ${index} venueId is required`);
    if (typeof observation.pubName !== "string" || !observation.pubName.trim()) errors.push(`observation ${index} pubName is required`);
    const canonicalName = BOROUGH_BY_CODE.get(String(observation.boroughCode));
    if (!canonicalName || canonicalName !== observation.boroughName) errors.push(`observation ${index} borough is not canonical`);
    if (!Number.isInteger(observation.pricePence) || Number(observation.pricePence) <= 0) errors.push(`observation ${index} pricePence must be a positive integer`);
    if (!isIsoDate(observation.observedAt)) errors.push(`observation ${index} observedAt must be an ISO date`);
    if (!sourceIds.has(String(observation.sourceId))) errors.push(`observation ${index} references an unknown source`);
    if (isRecord(window) && isIsoDate(observation.observedAt) &&
        (Date.parse(observation.observedAt) < Date.parse(String(window.start)) || Date.parse(observation.observedAt) > Date.parse(String(window.end)))) {
      errors.push(`observation ${index} is outside observationWindow`);
    }
  });
  if (value.status === "empty" && observations.length !== 0) errors.push("empty snapshots cannot contain observations");
  if (value.status !== "empty" && observations.length === 0) errors.push("published/partial snapshots require observations");
  if (observations.length > 0 && window === null) errors.push("observations require an observationWindow");
  if (!Array.isArray(value.excluded)) errors.push("excluded must be an array");

  return errors.length ? { ok: false, errors } : { ok: true, snapshot: value as PintIndexSnapshot };
}

export type LeagueRow = {
  slug: string;
  name: LondonBoroughName;
  pubCount: number;
  averageGbp: number;
  minGbp: number;
  minPubName: string;
  maxGbp: number;
  /** The pub behind maxGbp. The dearest end is a claim about a real bar too. */
  maxPubName: string;
};

export function buildLeagueTable(snapshot: PintIndexSnapshot): LeagueRow[] {
  const latest = new Map<string, PintIndexObservation>();
  for (const observation of snapshot.observations) {
    const prior = latest.get(observation.venueId);
    if (!prior || Date.parse(observation.observedAt) > Date.parse(prior.observedAt)) latest.set(observation.venueId, observation);
  }
  const grouped = new Map<string, PintIndexObservation[]>();
  for (const observation of latest.values()) {
    const rows = grouped.get(observation.boroughCode) ?? [];
    rows.push(observation);
    grouped.set(observation.boroughCode, rows);
  }
  return [...grouped.entries()].map(([slug, rows]) => {
    const prices = rows.map((row) => row.pricePence);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      slug,
      name: rows[0].boroughName,
      pubCount: rows.length,
      averageGbp: Math.round(prices.reduce((sum, price) => sum + price, 0) / rows.length) / 100,
      minGbp: min / 100,
      minPubName: rows.find((row) => row.pricePence === min)!.pubName,
      maxGbp: max / 100,
      maxPubName: rows.find((row) => row.pricePence === max)!.pubName,
    };
  }).sort((a, b) => a.averageGbp - b.averageGbp || a.name.localeCompare(b.name));
}

/**
 * The same table, read from the expensive end.
 *
 * A drinker wants cheap, so cheapest-first stays the default everywhere and
 * `buildLeagueTable` is untouched. A journalist wants dear, and ranks by the
 * single dearest pint rather than by the borough average: that is the number
 * that puts a town in a newspaper. So this orders by `maxGbp`, descending, and
 * returns a new array rather than sorting in place.
 */
export function dearestFirst(rows: readonly LeagueRow[]): LeagueRow[] {
  return [...rows].sort((a, b) => b.maxGbp - a.maxGbp || a.name.localeCompare(b.name));
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// One column table, so a header can never disagree with the cells under it.
// The dearest column names its pub the way the cheapest one already does: a
// reader ranking by the expensive end needs the bar, not just the figure.
type LeagueCsvColumn = {
  name: string;
  cell: (row: LeagueRow, snapshot: PintIndexSnapshot) => string;
};

const LEAGUE_CSV_COLUMNS: readonly LeagueCsvColumn[] = [
  { name: "borough_code", cell: (row) => row.slug },
  { name: "borough", cell: (row) => csvField(row.name) },
  { name: "tracked_pubs", cell: (row) => String(row.pubCount) },
  { name: "average_pint_gbp", cell: (row) => row.averageGbp.toFixed(2) },
  { name: "cheapest_pint_gbp", cell: (row) => row.minGbp.toFixed(2) },
  { name: "cheapest_pint_pub", cell: (row) => csvField(row.minPubName) },
  { name: "dearest_pint_gbp", cell: (row) => row.maxGbp.toFixed(2) },
  { name: "dearest_pint_pub", cell: (row) => csvField(row.maxPubName) },
  { name: "observation_start", cell: (_row, snapshot) => snapshot.observationWindow?.start ?? "" },
  { name: "observation_end", cell: (_row, snapshot) => snapshot.observationWindow?.end ?? "" },
  { name: "snapshot_id", cell: (_row, snapshot) => csvField(snapshot.snapshotId) },
];

/**
 * Columns the LIVE export carries and a PUBLISHED edition does not.
 *
 * A dated edition is written once, which is the whole reason a citation to one
 * still resolves to the same bytes next year. Widening its CSV shifts every
 * column after the new one along for anyone parsing by position, with no figure
 * moved and no correction note to explain the change - exactly the surprise the
 * written-once law exists to prevent. So a new column joins the live export
 * first and only reaches the frozen editions through a deliberate correction.
 */
const LIVE_ONLY_CSV_COLUMNS = new Set(["dearest_pint_pub"]);

const PUBLISHED_EDITION_CSV_COLUMNS = LEAGUE_CSV_COLUMNS.filter(
  (column) => !LIVE_ONLY_CSV_COLUMNS.has(column.name),
);

/** The live export's columns, in order. */
export const LEAGUE_CSV_HEADER = LEAGUE_CSV_COLUMNS.map((column) => column.name);

/** The columns every published edition was frozen with. */
export const PUBLISHED_EDITION_CSV_HEADER = PUBLISHED_EDITION_CSV_COLUMNS.map(
  (column) => column.name,
);

function toCsv(
  columns: readonly LeagueCsvColumn[],
  snapshot: PintIndexSnapshot,
  rows: readonly LeagueRow[],
): string {
  const lines = [columns.map((column) => column.name).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => column.cell(row, snapshot)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function leagueTableToCsv(snapshot: PintIndexSnapshot, rows = buildLeagueTable(snapshot)): string {
  return toCsv(LEAGUE_CSV_COLUMNS, snapshot, rows);
}

/** The CSV of a frozen month, in the shape it was published in. */
export function publishedEditionToCsv(
  snapshot: PintIndexSnapshot,
  rows = buildLeagueTable(snapshot),
): string {
  return toCsv(PUBLISHED_EDITION_CSV_COLUMNS, snapshot, rows);
}

// en-GB, London time, so "30 June 2026" reads the same wherever the build runs.
const INDEX_DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" });

/** How every date on the Index and its dated editions is written. */
export function formatPintIndexDate(value: string): string {
  return INDEX_DATE.format(new Date(value));
}

export function indexSummary(rows: LeagueRow[]) {
  const pubCount = rows.reduce((sum, row) => sum + row.pubCount, 0);
  const weighted = rows.reduce((sum, row) => sum + row.averageGbp * row.pubCount, 0);
  return {
    boroughCount: rows.length,
    pubCount,
    averageGbp: pubCount ? Math.round(weighted / pubCount * 100) / 100 : null,
    cheapestBorough: rows[0] ?? null,
    dearestBorough: rows.length ? rows.reduce((best, row) => row.averageGbp > best.averageGbp ? row : best) : null,
    // The single dearest eligible pint on the table, and where it is. A borough
    // average answers "which patch is pricey"; this answers "what is the worst
    // of it", which is the question the expensive end is actually asked.
    dearestPint: rows.length ? dearestFirst(rows)[0] : null,
  };
}
