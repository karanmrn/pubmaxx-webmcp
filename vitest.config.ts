import { randomBytes } from "node:crypto";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// One fresh key per Vitest invocation, serialized through test.env to every
// worker. This keeps production-mode unit tests realistic without weakening
// application policy or placing secret material in npm commands / process argv.
const VITEST_PLAN_SIGNING_SECRET = randomBytes(32).toString("base64url");

// Node environment: we test pure functions (venues, curation) and the API route
// handler by calling it directly — no DOM needed. "@/..." resolves to repo root,
// matching tsconfig paths.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    env: {
      PLAN_IDEMPOTENCY_SECRET: VITEST_PLAN_SIGNING_SECRET,
    },
    // Strips Vercel deployment env vars (VERCEL_ENV, VERCEL) so build-pipeline
    // test runs don't masquerade as production runtimes — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    // v8 coverage instrumentation plus concurrent agent worktrees can starve
    // repository-wide scans and subprocess validation past the default 5s.
    // Keep a bounded 60s ceiling so those real assertions remain deterministic
    // without turning a genuine hang into an unbounded release wait.
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Score the business logic (pure libs) and the API route handlers — the
      // surfaces where a regression actually breaks the app. UI components are
      // excluded; they're covered by the Playwright E2E suite instead.
      include: ["lib/**", "app/api/**"],
      exclude: ["**/*.d.ts", "**/*.d.mts"],
      // Regression gate, not a target. Thresholds sit ~2% under the measured
      // numbers so CI stays green today (2026-07-09: lines 75.86%, functions
      // 78.82%, statements 72.86% — up from 74.03/77.43/71.04).
      // RATCHET RULE: thresholds only ever rise; re-floor them after each wave
      // that lands fully-tested pure libs. The point is to PREVENT a drop.
      thresholds: {
        lines: 74,
        functions: 77,
        statements: 71,
      },
    },
  },
});
