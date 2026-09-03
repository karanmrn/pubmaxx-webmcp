import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

const ALL_ROUTES = routeFiles(join(ROOT, "app/api"));
// ---------------------------------------------------------------------------
// Static call scanner: find JSON-emitting calls that carry an `error:` payload
// field and a 4xx/5xx status, without executing the route.
// ---------------------------------------------------------------------------

// Call names that produce a JSON Response. Local wrappers (json, jsonResponse,
// privateJson) are included so a new route cannot mint a fresh rogue envelope
// behind a helper name the sweep has seen before.
const EMITTERS =
  /\b(?:jsonNoStore|privateJson|jsonResponse|json|(?:NextResponse|Response)\.json)\s*\(/g;

type ErrorEmission = { line: number; call: string };

/** Balanced-paren capture of every JSON-emitting call in `source`. */
function jsonCalls(source: string): Array<{ index: number; call: string }> {
  const calls: Array<{ index: number; call: string }> = [];
  EMITTERS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMITTERS.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    let inString: string | null = null;
    while (depth > 0 && i < source.length) {
      const c = source[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === inString) inString = null;
      } else if (c === '"' || c === "'" || c === "`") inString = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    calls.push({ index: match.index, call: source.slice(match.index, i) });
  }
  return calls;
}

/**
 * A call is an ERROR RESPONSE when its payload carries a top-level `error:`
 * field and its status is not a known-2xx literal: a 4xx/5xx literal, a
 * positional 4xx/5xx number, or a dynamic `status` expression (a gate that
 * decided the status upstream). 2xx fail-soft payloads that carry an `error`
 * field beside real data (citymcp degrade answers, the freshness-audit cron
 * body) are exactly the shape this sweep must NOT flag.
 */
function rogueErrorEmissions(source: string): ErrorEmission[] {
  const found: ErrorEmission[] = [];
  for (const { index, call } of jsonCalls(source)) {
    if (!/[{,]\s*error\s*:/.test(call)) continue;
    const status =
      call.match(/status\s*:\s*(\d{3})/)?.[1] ??
      call.match(/\}\s*,\s*(\d{3})\s*\)\s*$/)?.[1] ??
      null;
    const dynamicStatus = /status\s*:\s*[a-zA-Z_$]|\bstatus\s*[,}]/.test(call);
    if (status === null && !dynamicStatus) continue; // no status → 200 payload
    if (status !== null && Number(status) < 400) continue; // explicit 2xx/3xx
    found.push({ line: source.slice(0, index).split("\n").length, call });
  }
  return found;
}

/** One level of local helper imports, so delegated envelopes stay fenced. */
function importedLibModules(source: string): string[] {
  const modules = new Set<string>();
  for (const match of source.matchAll(/from "@\/(lib\/[\w/.-]+)"/g)) {
    for (const suffix of ["", ".ts", ".tsx"]) {
      const candidate = join(ROOT, match[1] + suffix);
      if (candidate.endsWith(".ts") || candidate.endsWith(".tsx") || candidate.endsWith(".mjs")) {
        if (existsSync(candidate)) {
          modules.add(candidate);
          break;
        }
      }
    }
  }
  return [...modules];
}

// Documented exemptions from the flat-envelope sweep. Each names what it emits
// instead and why. This list may only shrink; it is not a mute button.
const ENVELOPE_EXEMPT_FILES = new Set<string>([
  // Defines both the flat envelope and the legacy nested Heritage envelope
  // (a shipped consumer still reads the nested shape).
  "lib/apiError.ts",
]);

describe("app/api public error envelope (tree-wide)", () => {
  it("routes every 4xx/5xx JSON error through publicApiError, in routes and their one-level helpers", () => {
    const failures: string[] = [];
    const helperFiles = new Set<string>();

    for (const file of ALL_ROUTES) {
      const source = readFileSync(file, "utf8");
      for (const emission of rogueErrorEmissions(source)) {
        failures.push(
          `${relative(ROOT, file)}:${emission.line}: ${emission.call.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      }
      for (const helper of importedLibModules(source)) helperFiles.add(helper);
    }

    // A route may delegate its envelope to a lib helper; the helper then owes
    // the same contract, so sweep one level of local imports too.
    for (const helper of [...helperFiles].sort()) {
      if (ENVELOPE_EXEMPT_FILES.has(relative(ROOT, helper))) continue;
      const source = readFileSync(helper, "utf8");
      for (const emission of rogueErrorEmissions(source)) {
        failures.push(
          `${relative(ROOT, helper)}:${emission.line}: ${emission.call.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the exemption list honest: every entry still exists", () => {
    for (const file of ENVELOPE_EXEMPT_FILES) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate-limit fence: every non-cron mutating route must reference a limiter or
// a named delegation whose helper rate-limits for it.
// ---------------------------------------------------------------------------

// Tokens that prove a route (or its named gate) consults a rate limiter.
// `preparePlanGeneration` is a delegation: lib/planGeneration.server.ts
// rate-limits generation before loading planning data. `socialCrewActor` is a delegation: lib/socialCrewHttp.ts rate-limits every
// write actor before the route body runs. `handleProfileImage*` are the same
// shape: lib/profileImageRoute.server.ts owns the per-actor budget for the
// avatar and cover slots, which take one identical journey.
// `handleProfileCoverPhoto*` is that same delegation for the cover ROTATION:
// lib/profileCoverPhotoRoute.server.ts spends a per-actor budget on every add,
// remove and reorder, and a per-actor budget on every reader flag.
const LIMITER_TOKENS =
  /\bisLimited\b|[a-zA-Z]+RateLimited\b|\bis[A-Z][a-zA-Z]*Limited\b|\bpreparePlanGeneration\b|\bsocialCrewActor\b|\bhandleProfileImage(?:Upload|Delete|Report)\b|\bhandleProfileCoverPhoto(?:Upload|Delete|Move|Report)\b/;

describe("app/api rate limiting (tree-wide)", () => {
  it("gates every cron route with assertCronRequest instead of a limiter", () => {
    for (const file of ALL_ROUTES.filter((path) => path.includes("/cron/"))) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).toMatch(/assertCronRequest\s*\(/);
    }
  });

  it("references a rate limiter (or a named delegation) in every non-cron mutating route", () => {
    const failures: string[] = [];
    for (const file of ALL_ROUTES) {
      if (file.includes("/cron/")) continue;
      const source = readFileSync(file, "utf8");
      const mutating = /export (?:async )?(?:function|const) (?:POST|PUT|PATCH|DELETE)\b/.test(
        source,
      );
      if (!mutating) continue;
      if (LIMITER_TOKENS.test(source)) continue;
      failures.push(relative(ROOT, file));
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("THE LOCAL public error envelope", () => {
  it("routes every documented THE LOCAL error through the flat public helper", () => {
    const files = [
      ...routeFiles(join(ROOT, "app/api/plans")),
      ...routeFiles(join(ROOT, "app/api/night-areas")),
      join(ROOT, "app/api/late-food/route.ts"),
      join(ROOT, "app/api/me/night-profile/route.ts"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /jsonNoStore\s*\(\s*(?:\{\s*error\b|publicError\s*\(|PLAN_IDEMPOTENCY_ERROR\b|failure\.body\b)/,
      );
      expect(source, file).not.toMatch(/Response\.json\s*\(\s*\{\s*error\b/);
      if (/\berror\s*:|publicApiError|collaborationErrorResponse/.test(source)) {
        expect(source, file).toMatch(/publicApiError|collaborationErrorResponse/);
      }
    }
  });

  it("keeps the flat helper's stable human and machine fields", async () => {
    const { publicApiError } = await import("@/lib/apiError");
    const response = publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
    expect(await response.json()).toEqual({
      error: "That Plan doesn't exist.",
      code: "PLAN_NOT_FOUND",
      retryable: false,
    });
  });

  it("derives the conventional generic code and retryability from a bare status", async () => {
    const { publicApiErrorFromStatus } = await import("@/lib/apiError");
    const forbidden = publicApiErrorFromStatus("You're not in this Round.", 403);
    expect(await forbidden.json()).toEqual({
      error: "You're not in this Round.",
      code: "FORBIDDEN",
      retryable: false,
    });
    const outage = publicApiErrorFromStatus("Profile storage is unavailable.", 503);
    expect(await outage.json()).toEqual({
      error: "Profile storage is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });
});
