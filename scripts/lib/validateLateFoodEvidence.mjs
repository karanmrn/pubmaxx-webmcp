export const EXPECTED_NIGHT_AREA_SLUGS = [
  "clapham",
  "victoria",
  "piccadilly-soho",
  "canary-wharf",
  "barnes",
  "chiswick",
  "shoreditch",
  "camden",
  "brixton",
  "bermondsey-london-bridge",
  "kings-cross",
  "islington",
  "dalston",
  "peckham",
  "greenwich",
  "hammersmith",
  "balham",
  "marylebone",
  "richmond",
  "putney",
];

const ELIGIBLE_OPERATOR_HOSTS = new Set([
  "balans.co.uk",
  "www.balans.co.uk",
  "honestburgers.co.uk",
  "www.honestburgers.co.uk",
  "francomanca.co.uk",
  "www.francomanca.co.uk",
  "pizzapilgrims.co.uk",
  "www.pizzapilgrims.co.uk",
  "rickstein.com",
  "www.rickstein.com",
]);
const STATUSES = new Set(["partial", "reviewed", "insufficient_evidence"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const isRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const iso = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function eligibleSourceUrl(value) {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ELIGIBLE_OPERATOR_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function words(value) {
  return ` ${String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function namesPlace(haystack, place) {
  return haystack.includes(` ${place} `);
}

function sameUrl(left, right) {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

function isPdfUrl(value) {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function operatorHost(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function anchorDocumentCoverageError(option, localityNames) {
  let anchorPath;
  try {
    anchorPath = words(new URL(option.anchor.sourceUrl).pathname);
  } catch {
    return null;
  }
  let ownPath = "";
  try {
    ownPath = words(new URL(option.source.sourceUrl).pathname);
  } catch {
    ownPath = "";
  }
  const identity = `${words(option.name)}${words(option.address)}${words(option.area)}${ownPath}`;
  for (const place of localityNames) {
    if (namesPlace(anchorPath, place) && !namesPlace(identity, place)) {
      return place;
    }
  }
  return null;
}

export function validateLateFoodEvidence(value, localityNames) {
  const errors = [];
  const places = (Array.isArray(localityNames) ? localityNames : [])
    .map((name) => words(name).trim())
    .filter(Boolean);
  if (places.length === 0) {
    errors.push(
      "a Greater London locality gazetteer is required to check anchor document coverage",
    );
  }
  if (!isRecord(value)) return ["snapshot must be an object"];
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!text(value.snapshotId)) errors.push("snapshotId is required");
  if (!iso(value.generatedAt)) errors.push("generatedAt must be an ISO date");
  if (!text(value.coveragePolicy)) errors.push("coveragePolicy is required");
  if (!isRecord(value.areas)) return [...errors, "areas must be an object"];

  const actualKeys = Object.keys(value.areas).sort();
  const expectedKeys = [...EXPECTED_NIGHT_AREA_SLUGS].sort();
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length)
    errors.push(`missing Night Area keys: ${missing.join(", ")}`);
  if (extra.length)
    errors.push(`unexpected Night Area keys: ${extra.join(", ")}`);

  const seenIds = new Set();
  for (const slug of EXPECTED_NIGHT_AREA_SLUGS) {
    const area = value.areas[slug];
    if (!isRecord(area)) {
      errors.push(`${slug}: coverage entry must be an object`);
      continue;
    }
    if (!STATUSES.has(area.status)) errors.push(`${slug}: invalid status`);
    if (!text(area.reason)) errors.push(`${slug}: reason is required`);
    if (!Array.isArray(area.options)) {
      errors.push(`${slug}: options must be an array`);
      continue;
    }
    if (area.options.length === 0 && area.status !== "insufficient_evidence")
      errors.push(`${slug}: empty coverage must be insufficient_evidence`);
    if (area.options.length > 0 && area.status === "insufficient_evidence")
      errors.push(
        `${slug}: evidenced coverage cannot be insufficient_evidence`,
      );

    for (const [index, option] of area.options.entries()) {
      const where = `${slug} option ${index}`;
      if (!isRecord(option)) {
        errors.push(`${where}: must be an object`);
        continue;
      }
      if (!text(option.id) || seenIds.has(option.id))
        errors.push(`${where}: id is missing or duplicated`);
      seenIds.add(option.id);
      if (
        !text(option.name) ||
        option.area !== slug ||
        !text(option.category) ||
        !text(option.address)
      )
        errors.push(
          `${where}: identity, area, category and address are required`,
        );
      if (
        !isRecord(option.coordinates) ||
        typeof option.coordinates.lat !== "number" ||
        typeof option.coordinates.lng !== "number" ||
        !Number.isFinite(option.coordinates.lat) ||
        !Number.isFinite(option.coordinates.lng) ||
        option.coordinates.lat < 51.26 ||
        option.coordinates.lat > 51.72 ||
        option.coordinates.lng < -0.55 ||
        option.coordinates.lng > 0.3 ||
        option.coordinates.method !== "operator_location_link"
      )
        errors.push(
          `${where}: coordinates need an operator location link and Greater London point`,
        );
      if (!text(option.serviceHoursText) || option.serviceHoursText.length < 24)
        errors.push(`${where}: explicit serviceHoursText is required`);
      if (
        !isRecord(option.weeklyHours) ||
        Object.keys(option.weeklyHours).sort().join("|") !==
          [...WEEKDAYS].sort().join("|")
      ) {
        errors.push(`${where}: weeklyHours must include every weekday`);
      } else {
        for (const day of WEEKDAYS) {
          const windows = option.weeklyHours[day];
          if (
            !Array.isArray(windows) ||
            windows.length === 0 ||
            windows.some(
              (window) =>
                !isRecord(window) ||
                !CLOCK.test(window.open) ||
                !CLOCK.test(window.close) ||
                typeof window.closesNextDay !== "boolean",
            )
          )
            errors.push(`${where}: ${day} has an invalid service window`);
        }
      }
      if (option.verifyOnNight !== true)
        errors.push(`${where}: verifyOnNight must be true`);
      if (!CONFIDENCES.has(option.confidence))
        errors.push(`${where}: invalid confidence`);
      if (
        !isRecord(option.anchor) ||
        !text(option.anchor.label) ||
        typeof option.anchor.price !== "number" ||
        !Number.isFinite(option.anchor.price) ||
        option.anchor.price <= 0 ||
        !eligibleSourceUrl(option.anchor.sourceUrl) ||
        !iso(option.anchor.observedAt)
      ) {
        errors.push(`${where}: a sourced anchor price is required`);
      } else if (isRecord(option.source)) {
        const foreign = anchorDocumentCoverageError(option, places);
        if (foreign) {
          errors.push(
            `${where}: anchor document names ${foreign}, which is not this venue; cite the branch's own document or drop the anchor`,
          );
        }
        if (isPdfUrl(option.anchor.sourceUrl)) {
          const link = option.source.anchorDocumentLink;
          if (
            !isRecord(link) ||
            !eligibleSourceUrl(link.pageUrl) ||
            !eligibleSourceUrl(link.documentUrl)
          ) {
            errors.push(
              `${where}: PDF anchor requires an explicit operator-page link`,
            );
          } else {
            if (!sameUrl(link.documentUrl, option.anchor.sourceUrl)) {
              errors.push(
                `${where}: anchorDocumentLink documentUrl must match the anchor source`,
              );
            }
            if (operatorHost(link.pageUrl) !== operatorHost(link.documentUrl)) {
              errors.push(
                `${where}: anchorDocumentLink page and document must share an operator host`,
              );
            }
            const provenancePages = [
              option.source.sourceUrl,
              ...(Array.isArray(option.source.supportingUrls)
                ? option.source.supportingUrls
                : []),
            ];
            if (!provenancePages.some((url) => sameUrl(url, link.pageUrl))) {
              errors.push(
                `${where}: anchorDocumentLink pageUrl must be recorded in the option provenance`,
              );
            }
          }
        }
      }
      if (
        !isRecord(option.source) ||
        option.source.kind !== "official_operator" ||
        !text(option.source.publisher) ||
        !eligibleSourceUrl(option.source.sourceUrl) ||
        !text(option.source.evidenceNote)
      ) {
        errors.push(
          `${where}: eligible official-operator provenance is required`,
        );
        continue;
      }
      if (
        option.source.supportingUrls !== undefined &&
        (!Array.isArray(option.source.supportingUrls) ||
          option.source.supportingUrls.length === 0 ||
          option.source.supportingUrls.some((url) => !eligibleSourceUrl(url)))
      ) {
        errors.push(
          `${where}: supportingUrls must contain only eligible official-operator URLs`,
        );
      }
      if (
        !iso(option.source.observedAt) ||
        !iso(option.source.reviewedAt) ||
        !iso(option.source.expiresAt)
      ) {
        errors.push(
          `${where}: observedAt, reviewedAt and expiresAt must be ISO dates`,
        );
        continue;
      }
      const observed = Date.parse(option.source.observedAt);
      const reviewed = Date.parse(option.source.reviewedAt);
      const expires = Date.parse(option.source.expiresAt);
      if (
        observed > reviewed ||
        reviewed >= expires ||
        reviewed > Date.parse(value.generatedAt)
      )
        errors.push(`${where}: provenance dates are out of order`);
    }
  }
  return errors;
}
