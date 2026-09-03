export type MigrationBatchStatus =
  | "prepared"
  | "running"
  | "shadowing"
  | "verified"
  | "cut_over"
  | "rolled_back"
  | "failed";

const TRANSITIONS: Readonly<Record<MigrationBatchStatus, readonly MigrationBatchStatus[]>> = {
  prepared: ["running", "rolled_back", "failed"],
  running: ["shadowing", "rolled_back", "failed"],
  shadowing: ["verified", "rolled_back", "failed"],
  verified: ["cut_over", "rolled_back", "failed"],
  cut_over: ["rolled_back", "failed"],
  rolled_back: [],
  failed: ["rolled_back"],
};

export function canTransitionMigration(
  from: MigrationBatchStatus,
  to: MigrationBatchStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
