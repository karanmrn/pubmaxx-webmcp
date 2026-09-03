import budgetsJson from "../perf/api-budgets.json" with { type: "json" };

export const API_BUDGET_METRICS = ["p50Ms", "p95Ms"];

export const API_BUDGET_METRIC_LABELS = {
  p50Ms: "p50 (ms)",
  p95Ms: "p95 (ms)",
};

export const API_BUDGETS = budgetsJson;

export function percentile(samples, fraction) {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function findApiBudgetBreaches(budgets, measured) {
  const breaches = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of API_BUDGET_METRICS) {
      const budget = route[metric];
      if (!measurement) {
        breaches.push({
          path: route.path,
          metric,
          measured: Number.NaN,
          budget,
          overBy: Number.NaN,
        });
        continue;
      }
      const value = measurement[metric];
      if (value <= budget) continue;
      breaches.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        overBy: Math.round(((value - budget) / budget) * 100),
      });
    }
  }
  return breaches;
}

function pad(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

function table(header, rows) {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

export function formatApiBreachTable(breaches) {
  if (breaches.length === 0) return "";
  return table(
    ["route", "metric", "measured", "budget", "over by"],
    breaches.map((breach) => [
      breach.path,
      API_BUDGET_METRIC_LABELS[breach.metric],
      figure(breach.measured),
      figure(breach.budget),
      Number.isFinite(breach.overBy) ? `+${breach.overBy}%` : "-",
    ]),
  );
}

export function formatApiMeasurementTable(budgets, measured) {
  const rows = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of API_BUDGET_METRICS) {
      rows.push([
        route.path,
        API_BUDGET_METRIC_LABELS[metric],
        figure(measurement ? measurement[metric] : Number.NaN),
        figure(route[metric]),
      ]);
    }
  }
  return table(["route", "metric", "measured", "budget"], rows);
}
