import * as runtime from "./apiBudgets.mjs";

export const API_BUDGET_METRICS = runtime.API_BUDGET_METRICS as readonly [
  "p50Ms",
  "p95Ms",
];

export type ApiBudgetMetric = (typeof API_BUDGET_METRICS)[number];

export type ApiJsonFieldType = "array" | "object" | "string" | "number" | "boolean";

export const API_BUDGET_METRIC_LABELS = runtime.API_BUDGET_METRIC_LABELS as Record<
  ApiBudgetMetric,
  string
>;

export type ApiRouteBudget = {
  path: string;
  why: string;
  requiredJsonFields: Readonly<Record<string, ApiJsonFieldType>>;
  sampleCount?: number;
  sampleNote?: string;
  seedP50Ms: number;
  seedP95Ms: number;
} & Record<ApiBudgetMetric, number>;

export type ApiBudgetMethod = {
  samples: number;
  warmupSamples: number;
  measure: string;
  target: string;
  countedUpTo: string;
};

export type ApiBudgets = {
  note: string;
  method: ApiBudgetMethod;
  routes: ApiRouteBudget[];
};

export const API_BUDGETS = runtime.API_BUDGETS as ApiBudgets;

export type ApiRouteMeasurement = Record<ApiBudgetMetric, number>;

export type ApiBudgetBreach = {
  path: string;
  metric: ApiBudgetMetric;
  measured: number;
  budget: number;
  overBy: number;
};

export const percentile = runtime.percentile as (
  samples: readonly number[],
  fraction: number,
) => number;

export const findApiBudgetBreaches = runtime.findApiBudgetBreaches as (
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
) => ApiBudgetBreach[];

export const formatApiBreachTable = runtime.formatApiBreachTable as (
  breaches: readonly ApiBudgetBreach[],
) => string;

export const formatApiMeasurementTable = runtime.formatApiMeasurementTable as (
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
) => string;
