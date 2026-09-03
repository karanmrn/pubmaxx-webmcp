import {
  isCanonicalNightOutPlaceSourceUrl,
  nightOutPlaceSourceName,
} from "./nightOutPlaceSourceUrl.mjs";

export const NIGHT_OUT_PLACE_CATEGORIES = Object.freeze([
  "restaurant",
  "attraction",
  "bar",
  "late_food",
]);
export const NIGHT_OUT_PLACE_JOBS = Object.freeze([
  "near_pub_food",
  "pre_pub_attraction",
  "late_night_bar",
  "crawl_ending_food",
]);
export const NIGHT_OUT_PLACE_MAX_AGE_HOURS = 24 * 30;
export const NIGHT_OUT_PLACE_MAX_AGE_MS =
  NIGHT_OUT_PLACE_MAX_AGE_HOURS * 60 * 60 * 1_000;
export const NIGHT_OUT_PLACE_PROVENANCE_REGISTRY_VERSION = 1;

export const NIGHT_OUT_PLACE_LONDON_BOUNDS = Object.freeze({
  minLat: 51.26,
  maxLat: 51.72,
  minLng: -0.55,
  maxLng: 0.3,
});

// Marketing / filler phrases are authoritative here because every night-out
// place producer and consumer must make the same publishability decision.
export const NIGHT_OUT_PLACE_SLOP_PHRASES = Object.freeze([
  "whether you",
  "welcome to",
  "vibrant",
  "nestled",
  "boasts",
  "perfect spot",
  "unwind",
  "for your entertainment",
  "something for everyone",
  "look no further",
  "hidden gem",
  "must-visit",
  "must visit",
  "wide selection of food and drinks",
  "plan your visit today",
]);

const EXCLAMATION_OPENER = /^\s*[^.!?]{0,160}!/;

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, max) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const iso = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function isNightOutPlaceSlopDescription(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    NIGHT_OUT_PLACE_SLOP_PHRASES.some((phrase) => lower.includes(phrase)) ||
    EXCLAMATION_OPENER.test(trimmed)
  );
}

export function presentableNightOutPlaceDescription(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && !isNightOutPlaceSlopDescription(trimmed) ? trimmed : null;
}

export function isNightOutPlaceJob(value) {
  return NIGHT_OUT_PLACE_JOBS.includes(value);
}

export function categoryForNightOutJob(job) {
  if (job === "near_pub_food") return "restaurant";
  if (job === "pre_pub_attraction") return "attraction";
  if (job === "late_night_bar") return "bar";
  if (job === "crawl_ending_food") return "late_food";
  return null;
}

export function jobForNightOutPlaceCategory(category) {
  if (category === "restaurant") return "near_pub_food";
  if (category === "attraction") return "pre_pub_attraction";
  if (category === "bar") return "late_night_bar";
  if (category === "late_food") return "crawl_ending_food";
  return null;
}

export function isLondonNightOutPlaceCoordinates(lat, lng) {
  const bounds = NIGHT_OUT_PLACE_LONDON_BOUNDS;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

export function isLondonNightOutPlaceLocation(value) {
  return (
    isRecord(value) &&
    isLondonNightOutPlaceCoordinates(value.lat, value.lng)
  );
}

export function nightOutPlaceRowValidationErrors(value) {
  if (!isRecord(value)) return ["row must be an object"];
  const errors = [];
  if (!text(value.id, 120)) {
    errors.push("id is required and must be at most 120 characters");
  }
  const expectedJob = jobForNightOutPlaceCategory(value.category);
  if (expectedJob === null || value.job !== expectedJob) {
    errors.push("category and night-out job do not match");
  }
  if (!text(value.name, 160)) {
    errors.push("name is required and must be at most 160 characters");
  }
  const description = text(value.description, 600)
    ? presentableNightOutPlaceDescription(value.description)
    : null;
  if (description === null || description !== value.description.trim()) {
    errors.push("description is missing or failed the slop filter");
  }
  if (!text(value.address, 300) || !text(value.area, 120)) {
    errors.push("address and area are required");
  }
  if (!isLondonNightOutPlaceLocation(value.location)) {
    errors.push("location must be in Greater London bounds");
  }
  if (
    !isCanonicalNightOutPlaceSourceUrl(value.sourceUrl) ||
    !text(value.sourceName, 160) ||
    nightOutPlaceSourceName(value.sourceUrl) !== value.sourceName
  ) {
    errors.push("source URL/name provenance is invalid");
  }
  if (
    !iso(value.observedAt) ||
    !iso(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.observedAt) ||
    Date.parse(value.expiresAt) - Date.parse(value.observedAt) >
      NIGHT_OUT_PLACE_MAX_AGE_MS
  ) {
    errors.push("observation/expiry dates are invalid");
  }
  if (
    !["exa", "firecrawl", "manual"].includes(value.discoveredVia) ||
    !["firecrawl", "manual"].includes(value.extractedVia) ||
    (value.extractedVia === "manual" && value.discoveredVia !== "manual")
  ) {
    errors.push("producer lineage is invalid");
  }
  return errors;
}

export function isValidNightOutPlace(value) {
  return nightOutPlaceRowValidationErrors(value).length === 0;
}

export function nightOutPlaceSnapshotValidationErrors(value) {
  if (!isRecord(value)) return ["snapshot must be an object"];
  if (
    value.version !== 1 ||
    value.provenanceRegistryVersion !==
      NIGHT_OUT_PLACE_PROVENANCE_REGISTRY_VERSION ||
    !iso(value.generatedAt) ||
    !["published", "empty"].includes(value.status) ||
    !Array.isArray(value.places)
  ) {
    return [
      "expected a v1 snapshot with generatedAt, status, registry version and places",
    ];
  }
  const errors = [];
  if (value.status === "empty" && value.places.length !== 0) {
    errors.push("empty snapshot contains rows");
  }
  if (value.status === "published" && value.places.length === 0) {
    errors.push("published snapshot has no rows");
  }
  const ids = new Set();
  for (const [index, row] of value.places.entries()) {
    const rowErrors = nightOutPlaceRowValidationErrors(row);
    for (const error of rowErrors) errors.push(`row ${index}: ${error}`);
    if (isRecord(row) && typeof row.id === "string") {
      if (ids.has(row.id)) errors.push(`row ${index}: missing or duplicate id`);
      ids.add(row.id);
    }
    if (
      isRecord(row) &&
      iso(row.observedAt) &&
      Date.parse(row.observedAt) > Date.parse(value.generatedAt)
    ) {
      errors.push(`row ${index}: observation/expiry dates are invalid`);
    }
  }
  return [...new Set(errors)];
}

export function isValidNightOutPlaceSnapshot(value) {
  return nightOutPlaceSnapshotValidationErrors(value).length === 0;
}

export function nightOutPlaceProvenanceRegistryValidationErrors(
  registry,
  snapshot,
) {
  if (!isRecord(registry)) return ["required provenance registry is invalid"];
  const producerIds = Array.isArray(registry.producers)
    ? registry.producers.map((producer) => producer?.id)
    : [];
  if (
    registry.version !== snapshot?.provenanceRegistryVersion ||
    !producerIds.includes("exa") ||
    !producerIds.includes("firecrawl")
  ) {
    return ["provenance registry version/providers do not match the snapshot"];
  }
  return [];
}

export function isCurrentNightOutPlace(place, now) {
  if (!isValidNightOutPlace(place)) return false;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const observedMs = Date.parse(place.observedAt);
  const expiresMs = Date.parse(place.expiresAt);
  return (
    Number.isFinite(nowMs) &&
    observedMs <= nowMs &&
    expiresMs > nowMs &&
    nowMs - observedMs <= NIGHT_OUT_PLACE_MAX_AGE_MS
  );
}
