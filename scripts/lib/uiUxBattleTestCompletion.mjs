function recordKey(origin, viewport, item) {
  return `${origin}/${viewport}/${item}`;
}

function countByKey(records, keyFor) {
  const counts = new Map();
  for (const record of records) {
    const key = keyFor(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function isUiUxFlowApplicable(flow, viewportName) {
  return !flow.desktopOnly || viewportName === "desktop-1440";
}

function validatePageRecord({
  origin,
  viewport,
  routeName,
  pageCounts,
  pages,
  motionPolicy,
  failures,
}) {
  const key = recordKey(origin, viewport, routeName);
  const count = pageCounts.get(key) ?? 0;
  if (count === 0) {
    failures.push(`Missing page record: ${key}`);
    return;
  }
  if (count > 1) {
    failures.push(`Duplicate page record: ${key}`);
    return;
  }
  const page = pages.find((candidate) =>
    candidate.origin === origin &&
    candidate.viewport === viewport &&
    candidate.routeName === routeName,
  );
  if (!page || typeof page.cls !== "number" || !Number.isFinite(page.cls)) {
    failures.push(`Missing CLS record: ${key}`);
  }
  if (!page || typeof page.reducedMotion !== "boolean") {
    failures.push(`Missing reduced-motion record: ${key}`);
    return;
  }
  const policy = motionPolicy?.[origin];
  if (
    (policy === "reduce" && !page.reducedMotion) ||
    (policy === "no-preference" && page.reducedMotion)
  ) {
    failures.push(`Reduced-motion policy mismatch: ${key}`);
  }
}

function validateFlowRecord({
  origin,
  viewport,
  flow,
  flowCounts,
  flowResults,
  failures,
}) {
  const key = recordKey(origin, viewport, flow.name);
  const count = flowCounts.get(key) ?? 0;
  if (count === 0) {
    failures.push(`Missing flow record: ${key}`);
    return;
  }
  if (count > 1) {
    failures.push(`Duplicate flow record: ${key}`);
    return;
  }
  const result = flowResults.find((candidate) =>
    candidate.origin === origin &&
    candidate.viewport === viewport &&
    candidate.name === flow.name,
  );
  if (isUiUxFlowApplicable(flow, viewport)) {
    const allowedUnavailable =
      result?.status === "not-applicable" &&
      flow.allowedNotApplicableResults?.some((allowed) =>
        Object.entries(allowed).every(([field, expected]) => result[field] === expected),
      );
    if (result?.status !== "passed" && !allowedUnavailable) {
      failures.push(`Failed applicable flow: ${key}`);
    }
  } else if (result?.status !== "not-applicable") {
    failures.push(`Invalid non-applicable flow: ${key}`);
  }
}

export function assertCompleteUiUxAudit({
  originNames,
  viewportNames,
  routeNames,
  flowDefinitions,
  clsBudget,
  motionPolicy,
  pages,
  flowResults,
}) {
  const pageCounts = countByKey(
    pages,
    ({ origin, viewport, routeName }) => recordKey(origin, viewport, routeName),
  );
  const flowCounts = countByKey(
    flowResults,
    ({ origin, viewport, name }) => recordKey(origin, viewport, name),
  );
  const failures = [];
  const expectedPageKeys = new Set();
  const expectedFlowKeys = new Set();

  if (typeof clsBudget !== "number" || !Number.isFinite(clsBudget) || clsBudget <= 0) {
    failures.push("Missing CLS budget");
  }
  for (const origin of originNames) {
    const policy = motionPolicy?.[origin];
    if (policy !== "reduce" && policy !== "no-preference") {
      failures.push(`Missing motion policy: ${origin}`);
    }
  }

  for (const origin of originNames) {
    for (const viewport of viewportNames) {
      for (const routeName of routeNames) {
        expectedPageKeys.add(recordKey(origin, viewport, routeName));
      }
      for (const flow of flowDefinitions) {
        expectedFlowKeys.add(recordKey(origin, viewport, flow.name));
      }
    }
  }
  for (const key of pageCounts.keys()) {
    if (!expectedPageKeys.has(key)) failures.push(`Unexpected page record: ${key}`);
  }
  for (const key of flowCounts.keys()) {
    if (!expectedFlowKeys.has(key)) failures.push(`Unexpected flow record: ${key}`);
  }

  for (const origin of originNames) {
    for (const viewport of viewportNames) {
      for (const routeName of routeNames) {
        validatePageRecord({
          origin,
          viewport,
          routeName,
          pageCounts,
          pages,
          motionPolicy,
          failures,
        });
      }

      for (const flow of flowDefinitions) {
        validateFlowRecord({
          origin,
          viewport,
          flow,
          flowCounts,
          flowResults,
          failures,
        });
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`UI UX audit incomplete\n${failures.join("\n")}`);
  }
}
