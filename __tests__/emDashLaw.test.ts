import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// THE EM-DASH LAW  (docs/VOICE.md · "House law")
//
// The owner's ruling, made permanent: an em dash in product copy reads as AI.
// A real person writes a full stop, a comma, or a colon. This fence reads the
// SOURCE of every user-facing surface and fails if any string a reader sees
// carries a banned dash. It is deliberately AST-based, not a grep: the codebase
// comments heavily with em dashes (this very file's siblings are full of them),
// and a comment is not copy. Only the words that reach a thirsty Londoner at
// 6pm are the law's business.
//
// WHAT IS A VIOLATION
//   1. U+2014 (—) anywhere in a string literal, template literal, or JSX text.
//   2. The HTML entity for an em dash (&mdash; / &#8212; / &#x2014;) in JSX text.
//   3. An en dash (U+2013 – or &ndash;) used as a CLAUSE SEPARATOR, i.e. with a
//      space on each side (" – "). That is an em dash wearing a smaller hat.
//
// WHAT IS ALLOWED (the allowlist)
//   • Code comments. Excluded structurally: the AST has no comment nodes, so we
//     never even see them. (Proven by the tfl.ts sanity test below.)
//   • aria-hidden decorative content. A purely decorative glyph a screen reader
//     skips is not read copy; JSX text inside an aria-hidden subtree is ignored.
//   • Imported third-party strings: module specifiers in import/export/require.
//   • Date and number ranges that use an en dash WITHOUT spaces (2019–2024,
//     28A–28B). That is correct typography, not a separator.
//   • The explicit EXCEPTIONS list below. It is empty today and should stay that
//     way; add to it only when a string genuinely, provably needs a dash, with a
//     reason, and expect to defend it.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

// Surfaces the law governs. Every .tsx under app/ and components/ is a rendered
// surface. app/ and lib/ are ALSO scanned wholesale for plain .ts: a route
// handler's JSON error strings and a digest generator's copy reach a reader
// exactly like JSX text does, and used to slip past this fence entirely
// because the old scan only walked .tsx. components/ stays .tsx-only for now
// - its .ts files are hooks and helpers, not string owners, and widening that
// scan is a separate call. The allowlists below name the plumbing files whose
// only dashes live in server logs, thrown developer errors, or never-rendered
// bookkeeping: words no reader ever sees. Adding a file here is a claim that
// NOTHING in it reaches a reader. If a listed file grows real copy, remove it
// and fix the dashes instead.
const APP_NON_COPY_ALLOWLIST: ReadonlySet<string> = new Set([
  // Route/sitemap machinery: URLs and config, not reader-facing strings.
  "app/robots.ts",
  "app/sitemap.ts",
]);
const LIB_NON_COPY_ALLOWLIST: ReadonlySet<string> = new Set([
  // Server stores and providers: degraded-write and fallback log lines only.
  "lib/areaDemandStore.ts",
  "lib/commentsStore.ts",
  "lib/emailProvider.ts",
  "lib/feedFreshnessStore.ts",
  "lib/messagesStore.ts",
  "lib/notificationsStore.ts",
  "lib/operatorProposalsStore.ts",
  "lib/pintDropsStore.ts",
  "lib/priceConfirmStore.ts",
  "lib/pushProvider.ts",
  "lib/ratingsStore.ts",
  "lib/storeBackend.ts",
  "lib/venueOperatorsStore.ts",
  "lib/visitReportsStore.ts",
  "lib/walkRouteStore.ts",
  "lib/weatherProvider.ts",
  "lib/weatherSnapshotStore.ts",
  // Ops plumbing: cron/env/limiter guards that log or throw for developers.
  "lib/cronAuth.ts",
  "lib/dataFreshness.ts",
  "lib/freshnessNotify.ts",
  "lib/serverEnv.ts",
  "lib/supabase.ts",
  // Curated data whose dashed venueHint strings are reviewer-only bookkeeping,
  // documented in-file as never rendered (chips are labelled elsewhere).
  "lib/venueAccessibilitySeeds.ts",
]);

// Provably-necessary dashes, keyed by file + 1-based line + reason. EMPTY TODAY.
const EXCEPTIONS: ReadonlyArray<{ file: string; line: number; reason: string }> = [];

const EM_DASH = "—";
const EN_DASH = "–";
const EM_ENTITY = /&mdash;|&#8212;|&#x2014;/i;
// En dash as a clause separator: a space (or JSX &nbsp;/whitespace) on both sides.
const SPACED_EN = new RegExp(`(?:\\s|&nbsp;)(?:${EN_DASH}|&ndash;)(?:\\s|&nbsp;)`, "i");

type Violation = { file: string; line: number; kind: string; reason: string; text: string };

function walkDir(dir: string, out: string[], ext: RegExp): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walkDir(full, out, ext);
    } else if (ext.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  // components/ stays .tsx-only: its .ts files are hooks and helpers.
  walkDir(join(ROOT, "components"), files, /\.tsx$/);

  // app/ is scanned wholesale for .ts and .tsx: route handlers, sitemap/robots
  // config, and page/layout components all live here, and a route's JSON
  // error string reaches a reader the same as JSX text does.
  const appFiles: string[] = [];
  walkDir(join(ROOT, "app"), appFiles, /\.tsx?$/);
  for (const f of appFiles) {
    const rel = f.replace(ROOT + "/", "");
    if (!APP_NON_COPY_ALLOWLIST.has(rel)) files.push(f);
  }

  const libFiles: string[] = [];
  walkDir(join(ROOT, "lib"), libFiles, /\.tsx?$/);
  for (const f of libFiles) {
    const rel = f.replace(ROOT + "/", "");
    if (!LIB_NON_COPY_ALLOWLIST.has(rel)) files.push(f);
  }
  return files.sort();
}

// Is this string literal an import/export/require specifier (third-party)?
function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === node;
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === node) {
    const ex = p.expression;
    if (ex.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(ex) && ex.text === "require") return true;
  }
  return false;
}

// Does an opening JSX element mark its subtree aria-hidden (and not ="false")?
function isAriaHiddenOpening(
  open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  for (const attr of open.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "aria-hidden") continue;
    const init = attr.initializer;
    if (!init) return true; // bare <span aria-hidden>
    if (ts.isStringLiteral(init)) return init.text !== "false";
    if (ts.isJsxExpression(init) && init.expression) {
      // aria-hidden={true} hides; aria-hidden={false} does not.
      return init.expression.kind !== ts.SyntaxKind.FalseKeyword;
    }
  }
  return false;
}

function classify(text: string): string | null {
  if (text.includes(EM_DASH)) return "em dash (U+2014)";
  if (EM_ENTITY.test(text)) return "em-dash entity (&mdash;)";
  if (SPACED_EN.test(text)) return "spaced en dash ( – ), a clause separator";
  return null;
}

function scanFile(absFile: string): Violation[] {
  const rel = absFile.replace(ROOT + "/", "");
  const src = readFileSync(absFile, "utf8");
  const sf = ts.createSourceFile(absFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Violation[] = [];

  const record = (text: string, node: ts.Node) => {
    const kind = classify(text);
    if (!kind) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    if (EXCEPTIONS.some((e) => e.file === rel && e.line === line)) return;
    found.push({ file: rel, line, kind, reason: kind, text: text.trim().slice(0, 100) });
  };

  const walk = (node: ts.Node, hidden: boolean): void => {
    let childHidden = hidden;

    if (ts.isJsxElement(node)) {
      childHidden = hidden || isAriaHiddenOpening(node.openingElement);
    }

    if (ts.isJsxText(node)) {
      if (!hidden) record(node.getText(sf), node);
    } else if (ts.isStringLiteralLike(node)) {
      if (!isModuleSpecifier(node)) record(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      record(node.head.text, node);
      for (const span of node.templateSpans) record(span.literal.text, node);
    }

    ts.forEachChild(node, (child) => walk(child, childHidden));
  };

  walk(sf, false);
  return found;
}

describe("the em-dash law (docs/VOICE.md house law)", () => {
  const files = collectFiles();
  const violations = files.flatMap(scanFile);

  it("scans a real spread of surfaces (the law is not looking at an empty tree)", () => {
    expect(files.length).toBeGreaterThan(400);
    // The wholesale lib sweep is really in the net, not just app/components.
    expect(files).toContain(join(ROOT, "lib/weeklyDigest.ts"));
    expect(files).toContain(join(ROOT, "lib/apiError.ts"));
    // The wholesale app/ .ts sweep reaches route handlers, not just page.tsx.
    expect(files).toContain(join(ROOT, "app/api/pint-drops/route.ts"));
    expect(files).toContain(join(ROOT, "app/today/todayArea.ts"));
  });

  it("keeps the lib allowlist honest (every entry exists; none is a rendered surface)", () => {
    for (const rel of LIB_NON_COPY_ALLOWLIST) {
      // A stale entry (file deleted or renamed) must be pruned, not carried.
      expect(() => statSync(join(ROOT, rel)), `allowlisted file missing: ${rel}`).not.toThrow();
      // The allowlist is for lib plumbing only; it must never grow to exempt a
      // rendered .tsx surface from the law.
      expect(rel.startsWith("lib/"), `allowlist entry outside lib/: ${rel}`).toBe(true);
      expect(rel.endsWith(".tsx"), `allowlist must not exempt a rendered surface: ${rel}`).toBe(false);
    }
  });

  it("keeps the app allowlist honest (every entry exists; none is a rendered surface)", () => {
    for (const rel of APP_NON_COPY_ALLOWLIST) {
      // A stale entry (file deleted or renamed) must be pruned, not carried.
      expect(() => statSync(join(ROOT, rel)), `allowlisted file missing: ${rel}`).not.toThrow();
      // The allowlist is for app/ config and manifest files only; it must
      // never grow to exempt a rendered .tsx surface or a route handler.
      expect(rel.startsWith("app/"), `allowlist entry outside app/: ${rel}`).toBe(true);
      expect(rel.endsWith(".tsx"), `allowlist must not exempt a rendered surface: ${rel}`).toBe(false);
      expect(rel.endsWith("route.ts"), `allowlist must not exempt a route handler: ${rel}`).toBe(false);
    }
  });

  it("finds no banned dash in any user-facing string", () => {
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  [${v.kind}]  ${JSON.stringify(v.text)}`)
      .join("\n");
    expect(violations, `\n${violations.length} em-dash-law violation(s):\n${report}\n`).toEqual([]);
  });

  it("keeps the exceptions list empty (a dash should never be necessary)", () => {
    expect(EXCEPTIONS).toEqual([]);
  });

  it("ignores em dashes that live only in code comments", () => {
    // lib/tfl.ts is dense with em dashes, all of them in // comments. If the
    // fence read raw bytes instead of the AST, this file alone would trip it.
    const commentDash = scanFile(join(ROOT, "lib/tfl.ts"));
    expect(commentDash).toEqual([]);
    expect(readFileSync(join(ROOT, "lib/tfl.ts"), "utf8")).toContain(EM_DASH);
  });
});
