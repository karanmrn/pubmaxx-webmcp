type PlaywrightDistDirEnv = Readonly<
  Partial<
    Pick<NodeJS.ProcessEnv, "NEXT_DIST_DIR" | "PW_NEXT_DIST_DIR" | "PW_SCREENSHOTS">
  >
>;

export function resolvePlaywrightNextDistDir(
  env: PlaywrightDistDirEnv = {
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR,
    PW_NEXT_DIST_DIR: process.env.PW_NEXT_DIST_DIR,
    PW_SCREENSHOTS: process.env.PW_SCREENSHOTS,
  },
): string {
  if (env.PW_NEXT_DIST_DIR !== undefined) return env.PW_NEXT_DIST_DIR;
  if (env.PW_SCREENSHOTS) return env.NEXT_DIST_DIR ?? ".next";
  return ".next-e2e";
}
