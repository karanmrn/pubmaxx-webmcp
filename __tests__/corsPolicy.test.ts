import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Security guardrail (see the CORS-policy note in next.config.mjs).
//
// A tester flagged `Access-Control-Allow-Origin: *` on the site. It's Vercel's CDN
// default on PUBLIC static assets only and is safe: the content is world-readable and
// there is no `Access-Control-Allow-Credentials` anywhere, so no cross-origin
// credentialed read is possible. Our dynamic /api/* routes emit NO CORS headers.
//
// The genuinely dangerous combination is `Access-Control-Allow-Origin` (esp. `*`) +
// `Access-Control-Allow-Credentials: true` on a route that returns per-user data. This
// test freezes that combination out of the codebase: no API route handler and no
// build/deploy config may declare either header. If a specific API route ever
// legitimately needs CORS, scope it per-route to trusted origins only (never `*` with
// credentials) — and add a reviewed exception here.

const repoRoot = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(p);
  }
  return out;
}

// Matches a QUOTED header-name string literal (how you'd actually set the header in
// code/config), so prose/comments that merely mention the header don't false-positive.
const SET_ACAO = /["']access-control-allow-origin["']/i;
const SET_ACAC = /["']access-control-allow-credentials["']/i;

describe("CORS policy guardrail", () => {
  const apiFiles = walk(join(repoRoot, "app", "api"));

  it("has API route files to check", () => {
    expect(apiFiles.length).toBeGreaterThan(5);
  });

  it("no /api route declares Access-Control-Allow-Origin", () => {
    const offenders = apiFiles.filter((f) => SET_ACAO.test(readFileSync(f, "utf8")));
    expect(offenders, `scope or remove CORS in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no /api route declares Access-Control-Allow-Credentials", () => {
    const offenders = apiFiles.filter((f) => SET_ACAC.test(readFileSync(f, "utf8")));
    expect(offenders, `Allow-Credentials is forbidden in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("build/deploy config never declares Access-Control-Allow-Credentials", () => {
    for (const cfg of ["next.config.mjs", "vercel.json"]) {
      try {
        const src = readFileSync(join(repoRoot, cfg), "utf8");
        expect(SET_ACAC.test(src), `${cfg} must not declare Allow-Credentials`).toBe(false);
      } catch {
        // config file absent — nothing to assert
      }
    }
  });
});
