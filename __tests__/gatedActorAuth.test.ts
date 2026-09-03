// A write that names an actor must prove who is acting.
//
// THE DEFECT THIS FENCES: a signed-in drinker tapped Follow on another profile
// and was told "This handle belongs to a signed-in account. Sign in as its
// owner to continue." The request carried the actor handle in its BODY and no
// bearer token, so the server saw an anonymous caller claiming a handle that is
// linked to an account - indistinguishable from a hijack, and refused as one.
// Their own handle. Their own session.
//
// The server side is already right: `resolveMessageHandle` prefers the
// JWT-linked handle and `gateHandleAction` refuses a linked handle to anyone
// else. The gap was every client that reached for plain `fetch`, which is a
// thing you cannot see by reading either side alone - hence a fence rather than
// a per-component test. A new composer added with `fetch` fails here.
//
// Anonymous writes remain valid for UNLINKED demo handles: `authedFetch` sends
// no header when there is no session, so the demo path is untouched.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const API_ROOT = join(ROOT, "app", "api");

/** The three seams that resolve an actor from the request rather than the body. */
const ACTOR_GATES = [
  "gateHandleAction",
  "requireLinkedActor",
  "resolveMessageHandle",
];

const MUTATING_METHOD = /method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/;
/** A bare `fetch(` - not `authedFetch(`, `accountBoundFetch(`, or `.fetch(`. */
const BARE_FETCH = /(?<![.\w])fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;

/**
 * A bare `fetch` that proves the caller some other way is not the defect. Both
 * of these are real, narrower authorities: the profile editor builds its own
 * bearer header, and the admin console carries a moderator session instead of
 * an account one. This list may shrink; adding to it needs a reason as good.
 */
const PROVES_THE_CALLER = /\bauthHeaders\(|\bSESSION_FETCH\b|authoriz/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every API path whose handler resolves the actor from the request. A dynamic
 * segment becomes a wildcard so `/api/profiles/${handle}/follow` matches.
 */
function gatedRoutePatterns(): RegExp[] {
  return walk(API_ROOT)
    .filter((file) => file.endsWith(`${sep}route.ts`))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return ACTOR_GATES.some((gate) => source.includes(gate));
    })
    .map((file) => {
      const segments = relative(API_ROOT, file).split(sep).slice(0, -1);
      const body = segments
        .map((segment) => (segment.startsWith("[") ? "[^/?]+" : escape(segment)))
        .join("/");
      return new RegExp(`^/api/${body}(?:[?#]|$)`);
    });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `/api/profiles/${x}/follow` reads as a path with one wildcard segment. */
function literalPath(raw: string): string {
  return raw
    .slice(1, -1)
    .replace(/\$\{[^}]*\}/g, "x")
    .split(/[?#]/)[0]
    .replace(/[?#].*$/, "");
}

describe("an actor-bearing write proves who is acting", () => {
  const patterns = gatedRoutePatterns();

  it("finds the gated routes at all", () => {
    expect(patterns.length).toBeGreaterThan(5);
    expect(
      patterns.some((pattern) => pattern.test("/api/profiles/someone/follow")),
    ).toBe(true);
  });

  it("has no browser write to a gated route on a bare fetch", () => {
    const sources = [
      ...walk(join(ROOT, "components")),
      ...walk(join(ROOT, "app")).filter((file) => !file.startsWith(API_ROOT)),
      ...walk(join(ROOT, "lib")),
    ];
    const offenders: string[] = [];

    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("/api/")) continue;
      for (const match of source.matchAll(BARE_FETCH)) {
        const path = literalPath(match[1]);
        const rest = source.slice(match.index, match.index + 420);
        if (!MUTATING_METHOD.test(rest)) continue;
        if (PROVES_THE_CALLER.test(rest)) continue;
        // A path with a wildcard segment still has to match its pattern.
        const gated = patterns.some((pattern) =>
          pattern.test(path.replace(/\/x(?=\/|$)/g, "/wildcard")),
        );
        if (gated) offenders.push(`${relative(ROOT, file)} → ${path}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
