// A response you decide not to read is a request that never finishes.
//
// THE DEFECT THIS FENCES: `WantedPlanChips` asked `/api/wanted?open=1` on every
// `/plan` visit. Signed out, the route answers 401, and the component did
// `if (!res.ok) return;`. A Next route handler answers `Transfer-Encoding:
// chunked` with no `Content-Length`, so Chromium cannot know the body ended
// until somebody drains it: the request never reached `requestfinished`, the
// page never reached `networkidle`, and the `/plan` screenshot spent its whole
// 90s budget waiting on a 401 nobody wanted to read. Deterministic, and
// invisible in every unit test, because the hang lives in the browser's network
// stack rather than in the component's logic.
//
// The rule is one sentence: BETWEEN learning a response's status and reading
// its body, an exit must let the body go. `discardBody` (lib/responseBody.ts)
// is the way to say so.
//
// WHAT THIS SWEEP CATCHES: an `if` about `<response>.ok` or `<response>.status`
// whose branch leaves - returns, throws, breaks, continues - before anything has
// read that response. That is the shape the defect had, and the shape a new
// reader reaches for.
//
// WHAT IT DOES NOT CATCH, deliberately: an exit guarded on something else
// entirely (`if (cancelled) return;` between the fetch and the read), and a
// `.then(res => ...)` chain that never binds the response to a name. Both leak
// the same way. Widening the rule to every exit in the window flags a few
// hundred sites, most of them a cancelled effect on an already-finished
// response, and a fence nobody can keep green is not a fence. Fix those where
// you find them.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { discardBody } from "@/lib/responseBody";

const ROOT = join(__dirname, "..");

/** A browser fetch under any of the names this tree calls it by. */
const RESPONSE_BINDING =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[^;]*?\b(?:authedFetch|authedActionFetch|accountBoundFetch|fetch)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_SPEC =
  /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Every module a browser can execute: each `"use client"` entry plus its import
 * closure. `.server.ts` never reaches a browser, so it is left out.
 */
function browserReachableModules(): string[] {
  const all = [
    ...walk(join(ROOT, "components")),
    ...walk(join(ROOT, "app")),
    ...walk(join(ROOT, "lib")),
  ];
  const reachable = new Set(
    all.filter((file) => /^["']use client["']/m.test(readFileSync(file, "utf8"))),
  );
  const queue = [...reachable];
  while (queue.length) {
    const file = queue.pop() as string;
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPEC)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const target = resolveImport(file, spec);
      if (!target || reachable.has(target) || /\.server\.tsx?$/.test(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return [...reachable].sort();
}

/**
 * A real read of the body, or the response handed to something else that reads
 * it (`readResponse(exchange)`). After either, nothing is owed here.
 */
const readsBody = (name: string) =>
  new RegExp(
    `\\b${name}\\.(json|text|arrayBuffer|blob|formData|bytes)\\s*\\(|\\b${name}\\.body\\b|\\b(?!discardBody\\b)[A-Za-z_$][\\w$]*\\(\\s*${name}\\s*[,)]`,
  );

/** A read or an explicit discard. Either settles one branch. */
const settlesBody = (name: string) =>
  new RegExp(
    `\\b${name}\\.(json|text|arrayBuffer|blob|formData|bytes)\\s*\\(|\\b${name}\\.body\\b|discardBody\\(\\s*${name}\\s*\\)`,
  );

/** The balanced `( ... )` of the `if` that starts at `at`. */
function ifCondition(source: string, at: number): { close: number; text: string } | null {
  const open = source.indexOf("(", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return { close: i, text: source.slice(open + 1, i) };
    }
  }
  return null;
}

/** The consequent of that `if`: a `{ ... }` block, or a single statement. */
function ifConsequent(source: string, close: number): string | null {
  let i = close + 1;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] === "{") {
    let depth = 0;
    for (let j = i; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) return source.slice(i, j + 1);
      }
    }
    return null;
  }
  const semicolon = source.indexOf(";", i);
  return semicolon < 0 ? null : source.slice(i, semicolon + 1);
}

/**
 * A discard that runs before the guard settles it, but only when it is a
 * SIBLING statement - one nested inside an earlier branch runs only on that
 * branch, so it says nothing about this one.
 */
function discardedBefore(
  source: string,
  from: number,
  until: number,
  name: string,
): boolean {
  const discard = new RegExp(`discardBody\\(\\s*${name}\\s*\\)`, "g");
  discard.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = discard.exec(source)) && match.index < until) {
    let depth = 0;
    for (let i = from; i < match.index; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    if (depth === 0) return true;
  }
  return false;
}

type Site = { file: string; line: number };

function unreadResponseExits(files: string[]): Site[] {
  return files.flatMap((file) =>
    unreadResponseExitsIn(readFileSync(file, "utf8"), relative(ROOT, file)),
  );
}

function unreadResponseExitsIn(source: string, label: string): Site[] {
  const offenders: Site[] = [];
  {
    for (const binding of source.matchAll(RESPONSE_BINDING)) {
      const name = binding[1];
      const start = binding.index as number;
      const after = source.slice(start);
      const read = readsBody(name).exec(after);
      // Nothing reads this response at all: the window runs to the end of its
      // function, capped so one unread response cannot swallow the next.
      const windowEnd = start + (read ? read.index : Math.min(after.length, 3000));

      const ifs = /\bif\s*\(/g;
      ifs.lastIndex = start;
      let found: RegExpExecArray | null;
      while ((found = ifs.exec(source)) && found.index < windowEnd) {
        const condition = ifCondition(source, found.index);
        if (!condition) continue;
        if (!new RegExp(`\\b${name}\\.(ok|status)\\b`).test(condition.text)) continue;
        const consequent = ifConsequent(source, condition.close);
        if (!consequent) continue;
        if (!/\b(return|throw|continue|break)\b/.test(consequent)) continue;
        if (settlesBody(name).test(consequent)) continue;
        if (discardedBefore(source, start, found.index, name)) continue;
        // Handing the response itself onward leaves the body to its new owner.
        // Naming one of its fields in a message does not, so drop the property
        // reads before looking for a bare mention.
        const bare = consequent.replace(new RegExp(`\\b${name}\\.[\\w$]+`, "g"), "");
        if (new RegExp(`\\b(return|throw)\\b[^;]*\\b${name}\\b`).test(bare)) continue;
        offenders.push({
          file: label,
          line: source.slice(0, found.index).split("\n").length,
        });
      }
    }
  }
  return offenders;
}

describe("a response nobody reads is let go of", () => {
  const modules = browserReachableModules();

  it("sweeps the browser modules, and the wanted surfaces are among them", () => {
    expect(modules.length).toBeGreaterThan(200);
    expect(modules).toContain(join(ROOT, "components", "wanted", "WantedPlanChips.tsx"));
    expect(modules).toContain(join(ROOT, "components", "wanted", "WantedList.tsx"));
  });

  it("still recognises the original defect", () => {
    // The exact shape `/plan` shipped.
    const defect = `
      const res = await authedFetch("/api/wanted?open=1");
      if (!res.ok) return;
      const body = await res.json();
    `;
    expect(unreadResponseExitsIn(defect, "defect")).toHaveLength(1);
    expect(
      unreadResponseExitsIn(defect.replace("return;", "{ discardBody(res); return; }"), "fixed"),
    ).toEqual([]);
  });

  it("reads each branch on its own, so an earlier one cannot cover a later one", () => {
    // One branch let the body go. The next one has to say so for itself.
    const partial = `
      const res = await fetch("/api/uk-base/x");
      if (res.status === 404) {
        discardBody(res);
        return null;
      }
      if (!res.ok) return null;
      const pub = await res.json();
    `;
    expect(unreadResponseExitsIn(partial, "partial")).toHaveLength(1);
  });

  it("asks nothing of a reader that hands the response on", () => {
    const relay = `
      const res = await fetch("/api/thing");
      if (!res.ok) return res;
      const body = await res.json();
    `;
    expect(unreadResponseExitsIn(relay, "relay")).toEqual([]);
  });

  it("still asks for a discard when the status only names itself in a message", () => {
    const shouty = `
      const res = await fetch("/api/thing");
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      const body = await res.json();
    `;
    expect(unreadResponseExitsIn(shouty, "shouty")).toHaveLength(1);
  });

  it("has no browser reader that leaves a non-ok body unread", () => {
    const offenders = unreadResponseExits(modules).map(
      (site) => `${site.file}:${site.line}`,
    );
    expect(offenders).toEqual([]);
  });
});

describe("discardBody", () => {
  it("cancels a body nobody read", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"status":"sign_in_required"}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 401 },
    );

    discardBody(response);
    await Promise.resolve();

    expect(cancelled).toBe(true);
    expect(response.bodyUsed).toBe(true);
  });

  it("leaves a body somebody is already reading alone", async () => {
    const response = new Response('{"ok":true}', { status: 200 });
    const reading = response.json();

    expect(() => discardBody(response)).not.toThrow();
    await expect(reading).resolves.toEqual({ ok: true });
  });

  it("says nothing about a bodyless answer", () => {
    expect(() => discardBody(new Response(null, { status: 204 }))).not.toThrow();
  });
});
