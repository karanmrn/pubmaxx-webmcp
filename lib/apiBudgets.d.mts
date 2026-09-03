export declare const API_BUDGET_METRICS: readonly ["p50Ms", "p95Ms"];

export declare const API_BUDGET_METRIC_LABELS: Readonly<{
  p50Ms: string;
  p95Ms: string;
}>;

export declare const API_BUDGETS: unknown;

export declare function percentile(
  samples: readonly number[],
  fraction: number,
): number;

export declare function findApiBudgetBreaches(
  budgets: readonly unknown[],
  measured: ReadonlyMap<string, unknown>,
): unknown[];

export declare function formatApiBreachTable(breaches: readonly unknown[]): string;

export declare function formatApiMeasurementTable(
  budgets: readonly unknown[],
  measured: ReadonlyMap<string, unknown>,
): string;
