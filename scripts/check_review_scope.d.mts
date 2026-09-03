export const MAX_REVIEW_FILES: number;
export const MAX_RUNTIME_DOMAINS: number;

export type ReviewCategory =
  | "source"
  | "migration"
  | "generated"
  | "evidence"
  | "test"
  | "config"
  | "docs"
  | "skill-pack"
  | "other";

export type ReviewScopeReport = {
  fileCount: number;
  categories: Partial<Record<ReviewCategory, string[]>>;
  categoryCounts: Partial<Record<ReviewCategory, number>>;
  domains: string[];
  warnings: string[];
  forbidden: Array<{ category: ReviewCategory; path: string }>;
  ok: boolean;
};

export function normalizeReviewPath(value: unknown): string;
export function classifyReviewFile(value: unknown): {
  path: string;
  category: ReviewCategory;
  domain: string | null;
};
export function summarizeReviewScope(values: readonly unknown[]): ReviewScopeReport;
export function changedFilesFromGit(
  base: string,
  head: string,
  cwd: string,
): string[];
export function runReviewScopeCli(
  argv?: string[],
  cwd?: string,
): ReviewScopeReport;
