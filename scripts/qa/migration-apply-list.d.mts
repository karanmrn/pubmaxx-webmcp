export function listMigrations(migrationsDir?: string): string[];

export function versionOf(filename: string): string | null;

export function parseAppliedVersions(text: string): Set<string>;

export function unappliedMigrations(
  migrations: readonly string[],
  appliedVersions: ReadonlySet<string>,
): string[];
