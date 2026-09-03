// Measured against the committed UK OSM pub reference on 2026-07-29. Product
// rows formed one cluster through 3.87 km, then a clear gap to contradictions
// starting at 5.44 km. Five kilometres keeps that empirical separation.
import { haversineKm as haversineDistanceKm } from "./geo.mjs";

export { haversineDistanceKm };

export const POSTCODE_COORDINATE_MAX_DISTANCE_KM = 5;

// Build matching and published leak detection intentionally have opposite
// contracts. A build decision must match its pre-publication row exactly so
// quarantine never broadens silently. Published validation tolerates only
// serialization-scale coordinate drift, then fails for human judgment instead
// of silently excluding the nearby row. Measured on committed product points
// on 2026-07-30: three closer pairs at 0.100 m, 0.278 m, and 0.346 m were
// duplicate aliases; nearest genuinely distinct venues were The Boathouse and
// The Rocket at 0.416 m. At London latitudes, 0.0000001 degrees is at most
// 0.0112 m, below 3% of that observed minimum.
export const POSTCODE_COORDINATE_PUBLISHED_LEAK_TOLERANCE_DEGREES =
  0.0000001;

const POSTCODE_PATTERN =
  /(?:^|[^A-Z0-9])([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[ABD-HJLNP-UW-Z]{2})(?=$|[^A-Z0-9])/i;

export function parseUkPostcode(value) {
  const match = String(value ?? "")
    .toUpperCase()
    .match(POSTCODE_PATTERN);
  if (!match) return null;
  return {
    postcode: `${match[1]} ${match[2]}`,
    outwardCode: match[1],
  };
}

export function matchesTolerantPublishedQuarantineLeak(row, entry) {
  const rowPostcode = parseUkPostcode(row?.address)?.postcode;
  const entryPostcode = parseUkPostcode(entry?.postcode)?.postcode;
  const rowLatitude = Number(row?.latitude);
  const rowLongitude = Number(row?.longitude);
  const entryLatitude = Number(entry?.latitude);
  const entryLongitude = Number(entry?.longitude);
  return (
    row?.pub_name === entry?.pubName &&
    Boolean(rowPostcode) &&
    rowPostcode === entryPostcode &&
    Number.isFinite(rowLatitude) &&
    Number.isFinite(rowLongitude) &&
    Number.isFinite(entryLatitude) &&
    Number.isFinite(entryLongitude) &&
    Math.abs(rowLatitude - entryLatitude) <=
      POSTCODE_COORDINATE_PUBLISHED_LEAK_TOLERANCE_DEGREES &&
    Math.abs(rowLongitude - entryLongitude) <=
      POSTCODE_COORDINATE_PUBLISHED_LEAK_TOLERANCE_DEGREES
  );
}

export function matchesStrictBuildQuarantineIdentity(row, entry) {
  const rowPostcode = parseUkPostcode(row?.address)?.postcode;
  const entryPostcode = parseUkPostcode(entry?.postcode)?.postcode;
  return (
    row?.pub_name === entry?.pubName &&
    Boolean(rowPostcode) &&
    rowPostcode === entryPostcode &&
    Number(row?.latitude) === entry?.latitude &&
    Number(row?.longitude) === entry?.longitude
  );
}

export function findTolerantPublishedQuarantineLeaks({
  publishedRows,
  quarantineRows,
}) {
  const leaks = [];
  for (const quarantine of quarantineRows) {
    for (const row of publishedRows) {
      if (matchesTolerantPublishedQuarantineLeak(row, quarantine)) {
        leaks.push({ row, quarantine });
      }
    }
  }
  return leaks;
}

export function publishedQuarantineLeakValidationErrors(options) {
  return findTolerantPublishedQuarantineLeaks(options).map(
    ({ quarantine }) =>
      `invalid postcode-coordinate quarantine: ${quarantine.appPriceId} (${quarantine.pubName}) reached the product dataset`,
  );
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildOutwardCodeReferences(osmPubs) {
  const grouped = new Map();
  for (const pub of osmPubs) {
    const parsed = parseUkPostcode(pub?.postcode);
    const latitude = Number(pub?.lat);
    const longitude = Number(pub?.lng);
    if (
      !parsed ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }
    const points = grouped.get(parsed.outwardCode) ?? new Map();
    points.set(`${latitude}|${longitude}`, { latitude, longitude });
    grouped.set(parsed.outwardCode, points);
  }

  return new Map(
    [...grouped].map(([outwardCode, uniquePoints]) => {
      const points = [...uniquePoints.values()];
      return [
        outwardCode,
        {
          outwardCode,
          latitude: median(points.map((point) => point.latitude)),
          longitude: median(points.map((point) => point.longitude)),
          sampleCount: points.length,
        },
      ];
    }),
  );
}

function describeException(index, message) {
  return `exception ${index}: ${message}`;
}

function validateExceptionShape(exception, index) {
  const errors = [];
  if (
    typeof exception?.appPriceId !== "string" ||
    exception.appPriceId.trim().length === 0
  ) {
    errors.push(describeException(index, "appPriceId must be non-empty"));
  }
  if (
    typeof exception?.pubName !== "string" ||
    exception.pubName.trim().length === 0
  ) {
    errors.push(describeException(index, "pubName must be non-empty"));
  }
  if (!parseUkPostcode(exception?.postcode)) {
    errors.push(
      describeException(index, "postcode must be a complete UK postcode"),
    );
  }
  if (
    !Number.isFinite(exception?.latitude) ||
    !Number.isFinite(exception?.longitude)
  ) {
    errors.push(
      describeException(index, "latitude and longitude must be finite numbers"),
    );
  }
  if (
    typeof exception?.reason !== "string" ||
    exception.reason.trim().length < 20
  ) {
    errors.push(
      describeException(index, "reason must contain at least 20 characters"),
    );
  }
  return errors;
}

function collectPostcodeCoordinateFindings({
  rows,
  osmPubs,
  maxDistanceKm,
}) {
  const references = buildOutwardCodeReferences(osmPubs);
  const findings = [];
  let checkedRows = 0;

  rows.forEach((row, rowIndex) => {
    const parsed = parseUkPostcode(row?.address);
    const reference = parsed
      ? references.get(parsed.outwardCode)
      : undefined;
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (
      !parsed ||
      !reference ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }
    checkedRows += 1;
    const distanceKm = haversineDistanceKm(
      reference.latitude,
      reference.longitude,
      latitude,
      longitude,
    );
    if (distanceKm <= maxDistanceKm) return;
    findings.push({
      rowIndex,
      appPriceId: String(row.app_price_id ?? ""),
      pubName: String(row.pub_name ?? ""),
      postcode: parsed.postcode,
      outwardCode: parsed.outwardCode,
      latitude,
      longitude,
      distanceKm,
      reference,
    });
  });

  return { checkedRows, referenceCount: references.size, findings };
}

function describeQuarantine(index, message) {
  return `quarantine ${index}: ${message}`;
}

function validateQuarantineShape(entry, index) {
  const errors = [];
  if (
    typeof entry?.appPriceId !== "string" ||
    entry.appPriceId.trim().length === 0
  ) {
    errors.push(describeQuarantine(index, "appPriceId must be non-empty"));
  }
  if (
    typeof entry?.pubName !== "string" ||
    entry.pubName.trim().length === 0
  ) {
    errors.push(describeQuarantine(index, "pubName must be non-empty"));
  }
  if (!parseUkPostcode(entry?.postcode)) {
    errors.push(
      describeQuarantine(index, "postcode must be a complete UK postcode"),
    );
  }
  if (
    !Number.isFinite(entry?.latitude) ||
    !Number.isFinite(entry?.longitude)
  ) {
    errors.push(
      describeQuarantine(
        index,
        "latitude and longitude must be finite numbers",
      ),
    );
  }
  if (
    typeof entry?.reason !== "string" ||
    entry.reason.trim().length < 20
  ) {
    errors.push(
      describeQuarantine(index, "reason must contain at least 20 characters"),
    );
  }
  return errors;
}

export function validatePostcodeCoordinateQuarantine({
  rows,
  osmPubs,
  quarantineRegistry,
  maxDistanceKm = POSTCODE_COORDINATE_MAX_DISTANCE_KM,
}) {
  const { checkedRows, referenceCount, findings } =
    collectPostcodeCoordinateFindings({
      rows,
      osmPubs,
      maxDistanceKm,
    });
  const quarantineRows = quarantineRegistry?.rows;
  const invalidQuarantines = [];
  const appliedQuarantineIds = new Set();
  const seenQuarantineIds = new Set();

  if (!Array.isArray(quarantineRows)) {
    invalidQuarantines.push("top-level rows must be an array");
  } else {
    quarantineRows.forEach((entry, index) => {
      const shapeErrors = validateQuarantineShape(entry, index);
      invalidQuarantines.push(...shapeErrors);
      if (shapeErrors.length > 0) return;

      if (seenQuarantineIds.has(entry.appPriceId)) {
        invalidQuarantines.push(
          describeQuarantine(
            index,
            `duplicate appPriceId ${entry.appPriceId}`,
          ),
        );
        return;
      }
      seenQuarantineIds.add(entry.appPriceId);

      const row = rows.find(
        (candidate) => candidate?.app_price_id === entry.appPriceId,
      );
      if (!row) {
        invalidQuarantines.push(
          describeQuarantine(
            index,
            `${entry.appPriceId} is not in the pre-publication dataset`,
          ),
        );
        return;
      }

      if (!matchesStrictBuildQuarantineIdentity(row, entry)) {
        invalidQuarantines.push(
          describeQuarantine(
            index,
            `identity fields do not match ${entry.appPriceId}`,
          ),
        );
        return;
      }

      const finding = findings.find(
        (candidate) => candidate.appPriceId === entry.appPriceId,
      );
      if (!finding) {
        invalidQuarantines.push(
          describeQuarantine(
            index,
            `${entry.appPriceId} is not a postcode-coordinate contradiction`,
          ),
        );
        return;
      }
      appliedQuarantineIds.add(entry.appPriceId);
    });
  }

  return {
    checkedRows,
    referenceCount,
    appliedQuarantines: findings.filter((finding) =>
      appliedQuarantineIds.has(finding.appPriceId),
    ),
    unquarantinedContradictions: findings.filter(
      (finding) => !appliedQuarantineIds.has(finding.appPriceId),
    ),
    invalidQuarantines,
  };
}

export function findPostcodeCoordinateContradictions({
  rows,
  osmPubs,
  exceptionRegistry,
  maxDistanceKm = POSTCODE_COORDINATE_MAX_DISTANCE_KM,
}) {
  const { checkedRows, referenceCount, findings } =
    collectPostcodeCoordinateFindings({
      rows,
      osmPubs,
      maxDistanceKm,
    });

  const exceptions = exceptionRegistry?.exceptions;
  const invalidExceptions = [];
  const appliedExceptionIds = new Set();
  const seenExceptionIds = new Set();

  if (!Array.isArray(exceptions)) {
    invalidExceptions.push("top-level exceptions must be an array");
  } else {
    exceptions.forEach((exception, index) => {
      const shapeErrors = validateExceptionShape(exception, index);
      invalidExceptions.push(...shapeErrors);
      if (shapeErrors.length > 0) return;

      if (seenExceptionIds.has(exception.appPriceId)) {
        invalidExceptions.push(
          describeException(
            index,
            `duplicate appPriceId ${exception.appPriceId}`,
          ),
        );
        return;
      }
      seenExceptionIds.add(exception.appPriceId);

      const row = rows.find(
        (candidate) => candidate?.app_price_id === exception.appPriceId,
      );
      if (!row) {
        invalidExceptions.push(
          describeException(
            index,
            `appPriceId ${exception.appPriceId} is not in the product dataset`,
          ),
        );
        return;
      }

      const rowPostcode = parseUkPostcode(row.address)?.postcode;
      const exceptionPostcode = parseUkPostcode(exception.postcode)?.postcode;
      if (
        row.pub_name !== exception.pubName ||
        rowPostcode !== exceptionPostcode ||
        Number(row.latitude) !== exception.latitude ||
        Number(row.longitude) !== exception.longitude
      ) {
        invalidExceptions.push(
          describeException(
            index,
            `identity fields do not exactly match ${exception.appPriceId}`,
          ),
        );
        return;
      }

      const finding = findings.find(
        (candidate) => candidate.appPriceId === exception.appPriceId,
      );
      if (!finding) {
        invalidExceptions.push(
          describeException(
            index,
            `${exception.appPriceId} is not a postcode-coordinate contradiction`,
          ),
        );
        return;
      }
      appliedExceptionIds.add(exception.appPriceId);
    });
  }

  return {
    checkedRows,
    referenceCount,
    contradictions: findings.filter(
      (finding) => !appliedExceptionIds.has(finding.appPriceId),
    ),
    appliedExceptions: findings.filter((finding) =>
      appliedExceptionIds.has(finding.appPriceId),
    ),
    invalidExceptions,
  };
}
