import {
  findPostcodeCoordinateContradictions,
  parseUkPostcode,
  validatePostcodeCoordinateQuarantine,
} from "./postcodeCoordinateConsistency.mjs";

function correctionError(index, message) {
  return `correction ${index}: ${message}`;
}

function validateCorrectionShape(correction, index) {
  const errors = [];
  if (
    typeof correction?.decisionId !== "string" ||
    correction.decisionId.trim().length === 0
  ) {
    errors.push(correctionError(index, "decisionId must be non-empty"));
  }
  if (
    !Array.isArray(correction?.appPriceIds) ||
    correction.appPriceIds.length === 0 ||
    correction.appPriceIds.some(
      (appPriceId) =>
        typeof appPriceId !== "string" || appPriceId.trim().length === 0,
    )
  ) {
    errors.push(
      correctionError(index, "appPriceIds must be a non-empty string array"),
    );
  }
  if (
    typeof correction?.match?.pubName !== "string" ||
    correction.match.pubName.trim().length === 0
  ) {
    errors.push(correctionError(index, "match.pubName must be non-empty"));
  }
  if (!parseUkPostcode(correction?.match?.postcode)) {
    errors.push(
      correctionError(index, "match.postcode must be a complete UK postcode"),
    );
  }
  if (
    !Number.isFinite(correction?.match?.latitude) ||
    !Number.isFinite(correction?.match?.longitude)
  ) {
    errors.push(
      correctionError(
        index,
        "match latitude and longitude must be finite numbers",
      ),
    );
  }
  if (
    !correction?.changes ||
    typeof correction.changes !== "object" ||
    Array.isArray(correction.changes) ||
    Object.keys(correction.changes).length === 0
  ) {
    errors.push(correctionError(index, "changes must be a non-empty object"));
  } else if (
    !Number.isFinite(correction.changes.latitude) ||
    !Number.isFinite(correction.changes.longitude)
  ) {
    errors.push(
      correctionError(
        index,
        "changes latitude and longitude must be finite numbers",
      ),
    );
  }
  if (
    typeof correction?.dataQualityNote !== "string" ||
    correction.dataQualityNote.trim().length === 0
  ) {
    errors.push(
      correctionError(index, "dataQualityNote must be non-empty"),
    );
  }
  if (
    typeof correction?.reason !== "string" ||
    correction.reason.trim().length < 20
  ) {
    errors.push(
      correctionError(index, "reason must contain at least 20 characters"),
    );
  }
  return errors;
}

function appendQualityNote(value, note) {
  return [
    ...new Set(
      `${value ?? ""}|${note}`
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].join("|");
}

export function applyPostcodeCoordinateCorrections({
  rows,
  correctionRegistry,
}) {
  const corrections = correctionRegistry?.corrections;
  const correctedRows = rows.map((row) => ({ ...row }));
  const invalidCorrections = [];
  const appliedCorrections = [];
  const seenDecisionIds = new Set();
  const seenAppPriceIds = new Set();

  if (!Array.isArray(corrections)) {
    invalidCorrections.push("top-level corrections must be an array");
    return { correctedRows, appliedCorrections, invalidCorrections };
  }

  corrections.forEach((correction, index) => {
    const shapeErrors = validateCorrectionShape(correction, index);
    invalidCorrections.push(...shapeErrors);
    if (shapeErrors.length > 0) return;

    if (seenDecisionIds.has(correction.decisionId)) {
      invalidCorrections.push(
        correctionError(
          index,
          `duplicate decisionId ${correction.decisionId}`,
        ),
      );
      return;
    }
    seenDecisionIds.add(correction.decisionId);

    const localIds = new Set();
    for (const appPriceId of correction.appPriceIds) {
      if (localIds.has(appPriceId) || seenAppPriceIds.has(appPriceId)) {
        invalidCorrections.push(
          correctionError(index, `duplicate appPriceId ${appPriceId}`),
        );
        continue;
      }
      localIds.add(appPriceId);
      seenAppPriceIds.add(appPriceId);

      const row = correctedRows.find(
        (candidate) => candidate.app_price_id === appPriceId,
      );
      if (!row) {
        invalidCorrections.push(
          correctionError(
            index,
            `${appPriceId} is not in the pre-publication dataset`,
          ),
        );
        continue;
      }

      const rowPostcode = parseUkPostcode(row.address)?.postcode;
      const matchPostcode = parseUkPostcode(correction.match.postcode)?.postcode;
      if (
        row.pub_name !== correction.match.pubName ||
        rowPostcode !== matchPostcode ||
        Number(row.latitude) !== correction.match.latitude ||
        Number(row.longitude) !== correction.match.longitude
      ) {
        invalidCorrections.push(
          correctionError(
            index,
            `identity fields do not exactly match ${appPriceId}`,
          ),
        );
        continue;
      }

      Object.assign(row, correction.changes);
      row.data_quality_notes = appendQualityNote(
        row.data_quality_notes,
        correction.dataQualityNote,
      );
      appliedCorrections.push({
        decisionId: correction.decisionId,
        appPriceId,
        pubName: correction.match.pubName,
        reason: correction.reason,
        changes: correction.changes,
        dataQualityNote: correction.dataQualityNote,
      });
    }
  });

  return { correctedRows, appliedCorrections, invalidCorrections };
}

export function resolvePostcodeCoordinateDecisions({
  rows,
  osmPubs,
  correctionRegistry,
  quarantineRegistry,
  exceptionRegistry,
}) {
  const correctionResult = applyPostcodeCoordinateCorrections({
    rows,
    correctionRegistry,
  });
  const quarantineResult = validatePostcodeCoordinateQuarantine({
    rows: correctionResult.correctedRows,
    osmPubs,
    quarantineRegistry,
  });
  const exceptionResult = findPostcodeCoordinateContradictions({
    rows: correctionResult.correctedRows,
    osmPubs,
    exceptionRegistry,
  });
  const quarantinedIds = new Set(
    quarantineResult.appliedQuarantines.map((entry) => entry.appPriceId),
  );
  const exceptedIds = new Set(
    exceptionResult.appliedExceptions.map((entry) => entry.appPriceId),
  );
  const invalidDecisions = [
    ...correctionResult.invalidCorrections.map(
      (error) => `invalid postcode-coordinate correction: ${error}`,
    ),
    ...quarantineResult.invalidQuarantines.map(
      (error) => `invalid postcode-coordinate quarantine: ${error}`,
    ),
    ...exceptionResult.invalidExceptions.map(
      (error) => `invalid postcode-coordinate exception: ${error}`,
    ),
  ];

  for (const appPriceId of quarantinedIds) {
    if (exceptedIds.has(appPriceId)) {
      invalidDecisions.push(
        `${appPriceId} cannot be both quarantined and excepted`,
      );
    }
  }

  const unhandledContradictions = exceptionResult.contradictions.filter(
    (finding) => !quarantinedIds.has(finding.appPriceId),
  );
  for (const finding of unhandledContradictions) {
    invalidDecisions.push(
      `unresolved postcode-coordinate contradiction ${finding.appPriceId} (${finding.pubName}): ${finding.postcode} is ${finding.distanceKm.toFixed(2)} km from its outward-code reference`,
    );
  }

  const registryQuarantineRows = Array.isArray(quarantineRegistry?.rows)
    ? quarantineRegistry.rows
    : [];
  const quarantineEntries = new Map(
    registryQuarantineRows.map((entry) => [
      entry.appPriceId,
      entry,
    ]),
  );
  const appliedQuarantines = quarantineResult.appliedQuarantines.map(
    (finding) => ({
      appPriceId: finding.appPriceId,
      pubName: finding.pubName,
      postcode: finding.postcode,
      latitude: finding.latitude,
      longitude: finding.longitude,
      reason: quarantineEntries.get(finding.appPriceId)?.reason,
    }),
  );

  return {
    correctedRows: correctionResult.correctedRows,
    appliedCorrections: correctionResult.appliedCorrections,
    appliedQuarantines,
    invalidDecisions,
    checkedRows: exceptionResult.checkedRows,
    referenceCount: exceptionResult.referenceCount,
  };
}
