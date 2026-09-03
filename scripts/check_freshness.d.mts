export type FreshnessStatus = "live" | "fresh" | "stale" | "untracked" | "unknown";

export type FreshnessResult = {
  id: string;
  label: string;
  class: string;
  cadence: string;
  refreshWorkflow: string;
  gate: string;
  artifact: string | null;
  stalenessBudgetHours: number | null;
  observedAt: string | null;
  ageHours: number | null;
  status: FreshnessStatus;
  detail: string;
};

export type FreshnessRegistry = {
  version: number;
  datasets: Array<Record<string, unknown>>;
};

export function loadRegistry(rootDir?: string): FreshnessRegistry;

export function evaluateFreshness(options?: {
  now?: Date;
  rootDir?: string;
  registry?: FreshnessRegistry;
}): Promise<{ results: FreshnessResult[]; breached: boolean }>;

export function formatFreshnessTable(results: FreshnessResult[]): string;
