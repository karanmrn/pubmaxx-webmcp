export type RuntimeDataPack = {
  readonly id: string;
  readonly modules: readonly string[];
  readonly files: readonly string[];
};

export const RUNTIME_DATA_PACKS: readonly RuntimeDataPack[];

export const RUNTIME_PATH_MODULES_TRACED_ELSEWHERE: Readonly<Record<string, string>>;

export const RUNTIME_PATH_MODULES_PENDING_DECLARATION: Readonly<Record<string, string>>;

export function discoverRuntimeReaderRouteGlobs(
  projectRoot: string,
  moduleRelativePath: string,
): string[];

export function discoverRuntimePathModules(projectRoot: string): string[];

export function runtimeDataPackRouteIncludes(projectRoot: string): Record<string, string[]>;
