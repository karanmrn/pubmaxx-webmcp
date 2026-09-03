import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  join,
  normalize,
  relative as pathRelative,
} from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const UNSUFFIXED_SERVER_ONLY_MODULES = [
  "adminAuth.ts",
  "authServer.ts",
  "freshnessArtifact.ts",
  "identityHandleStore.ts",
  "importNotesStore.ts",
  "messagesStore.ts",
  "privateIdentityStore.ts",
  "reactionsStore.ts",
  "socialConnectionStore.ts",
  "supabase.ts",
  "ukBaseIndex.ts",
] as const;

// Direct Node and Supabase capabilities are discovered automatically below.
// This legacy list retains named security boundaries from earlier fixes. Do not
// expand it to duplicate every module in the generated capability inventory.

const SERVER_IO_EXEMPTIONS = {
  "lib/authClient.ts": {
    capabilities: ["supabase-client"],
    kind: "browser",
    consumers: [
      "components/auth/AuthProvider.tsx",
      "components/auth/HandlePasswordSignIn.tsx",
      "components/auth/SetAccountPassword.tsx",
      "lib/authedFetch.ts",
      "lib/crewRealtime.ts",
      "lib/deviceAccountSwitch.ts",
      "lib/messagesRealtime.ts",
      "lib/realtime.ts",
    ],
    reason: "Creates the browser Supabase client with the public anonymous key.",
    removeWhen: "Browser authentication no longer uses Supabase directly.",
  },
  "lib/venueIndexTracing.mjs": {
    capabilities: ["node-runtime"],
    kind: "config",
    consumers: [
      "next.config.mjs",
      "__tests__/lastRideRoute.test.ts",
      "__tests__/venueIndexTracing.test.ts",
    ],
    reason: "Reads source files while Next configuration builds tracing includes.",
    removeWhen: "Tracing metadata no longer reads project files.",
  },
} as const;

const SERVER_IO_MODULES = new Set([
  "crypto",
  "fs",
  "fs/promises",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
]);

type Capability = "node-runtime" | "supabase-admin" | "supabase-client";

function isSourceFile(entry: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/.test(entry) && !entry.endsWith(".d.ts");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(path));
      continue;
    }
    if (isSourceFile(entry)) out.push(path);
  }
  return out;
}

const LOCAL_MODULE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
] as const;

function resolveLocalModule(
  root: string,
  importer: string,
  moduleName: string,
): string | null {
  const base = moduleName.startsWith("@/")
    ? join(root, moduleName.slice(2))
    : moduleName.startsWith(".")
      ? join(dirname(importer), moduleName)
      : null;
  if (!base) return null;
  const candidates = [
    ...LOCAL_MODULE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...LOCAL_MODULE_EXTENSIONS.slice(1).map((extension) =>
      join(base, `index${extension}`),
    ),
  ];
  const match = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  return match ? normalize(match) : null;
}

function projectRelative(root: string, file: string): string {
  return pathRelative(root, file).replaceAll("\\", "/");
}

function literalModuleName(node: ts.Node): string | null {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  return null;
}

function importHasRuntimeValue(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasRuntimeValue(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return true;
  return clause.elements.some((element) => !element.isTypeOnly);
}

function isLocalSupabaseAdminModule(
  name: string,
  sourceFile: string,
): boolean {
  const candidate = name.startsWith("@/")
    ? name.slice(2)
    : name.startsWith(".")
      ? join(dirname(sourceFile), name)
      : null;
  if (!candidate) return false;
  const resolved = normalize(candidate)
    .replaceAll("\\", "/")
    .replace(/\.[cm]?[jt]sx?$/, "");
  return resolved === "lib/supabase";
}

function sourceCapabilities(source: ts.SourceFile): Set<Capability> {
  const capabilities = new Set<Capability>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const name = node.moduleSpecifier
        ? literalModuleName(node.moduleSpecifier)
        : null;
      const hasRuntimeValue = ts.isImportDeclaration(node)
        ? importHasRuntimeValue(node)
        : exportHasRuntimeValue(node);
      if (name && SERVER_IO_MODULES.has(name) && hasRuntimeValue) {
        capabilities.add("node-runtime");
      }
      if (
        name &&
        isLocalSupabaseAdminModule(name, source.fileName) &&
        hasRuntimeValue
      ) {
        capabilities.add("supabase-admin");
      }
      if (
        name === "@supabase/supabase-js" &&
        hasRuntimeValue
      ) {
        capabilities.add("supabase-client");
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const name = literalModuleName(node.arguments[0]!);
        if (name && SERVER_IO_MODULES.has(name)) {
          capabilities.add("node-runtime");
        }
        if (name && isLocalSupabaseAdminModule(name, source.fileName)) {
          capabilities.add("supabase-admin");
        }
        if (name === "@supabase/supabase-js") {
          capabilities.add("supabase-client");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return capabilities;
}

function sourceRuntimeModuleNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const name = node.moduleSpecifier
        ? literalModuleName(node.moduleSpecifier)
        : null;
      const hasRuntimeValue = ts.isImportDeclaration(node)
        ? importHasRuntimeValue(node)
        : exportHasRuntimeValue(node);
      if (name && hasRuntimeValue) names.add(name);
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const name = literalModuleName(node.arguments[0]!);
        if (name) names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function hasServerOnlyMarker(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      !statement.importClause &&
      literalModuleName(statement.moduleSpecifier) === "server-only",
  );
}

function listLibServerModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listLibServerModules(path));
      continue;
    }
    if (/\.server\.[cm]?[jt]sx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe("server-only guard (#1043 L8)", () => {
  it("every server-only lib module imports server-only", () => {
    const root = join(process.cwd(), "lib");
    const files = [
      ...listLibServerModules(root),
      ...UNSUFFIXED_SERVER_ONLY_MODULES.map((file) => join(root, file)),
    ];
    const missing = files.filter((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      return !hasServerOnlyMarker(source);
    });
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("guards every direct server I/O module or documents an exact exemption", () => {
    const root = process.cwd();
    const files = listSourceFiles(join(root, "lib"));
    const projectImporterFiles = [
      join(root, "next.config.mjs"),
      ...listSourceFiles(join(root, "app")),
      ...listSourceFiles(join(root, "components")),
      ...files,
    ];
    const findings = new Map<string, Set<Capability>>();

    for (const file of files) {
      const relative = projectRelative(root, file);
      const source = ts.createSourceFile(
        relative,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const capabilities = sourceCapabilities(source);
      if (
        capabilities.size > 0 &&
        !hasServerOnlyMarker(source) &&
        !(relative in SERVER_IO_EXEMPTIONS)
      ) {
        findings.set(relative, capabilities);
      }
    }

    const staleExemptions = Object.entries(SERVER_IO_EXEMPTIONS).flatMap(
      ([relative, policy]) => {
        const file = join(root, relative);
        if (!existsSync(file) || !statSync(file).isFile()) {
          return [`${relative}: missing exemption target`];
        }
        const source = ts.createSourceFile(
          relative,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const capabilities = sourceCapabilities(source);
        const metadata = [
          policy.kind,
          policy.reason,
          policy.removeWhen,
          ...policy.capabilities,
          ...policy.consumers,
        ];
        const expectedCapabilities = [...policy.capabilities].sort();
        const consumerErrors = policy.consumers.flatMap((consumer) => {
          const consumerFile = join(root, consumer);
          if (!existsSync(consumerFile) || !statSync(consumerFile).isFile()) {
            return [`${relative}: consumer does not exist: ${consumer}`];
          }
          const consumerSource = ts.createSourceFile(
            consumer,
            readFileSync(consumerFile, "utf8"),
            ts.ScriptTarget.Latest,
            true,
          );
          const importsTarget = [...sourceRuntimeModuleNames(consumerSource)].some(
            (name) => resolveLocalModule(root, consumerFile, name) === normalize(file),
          );
          return importsTarget
            ? []
            : [`${relative}: listed consumer does not import target: ${consumer}`];
        });
        const undeclaredImporterErrors =
          policy.kind === "config"
            ? projectImporterFiles.flatMap((importerFile) => {
                const importerRelative = projectRelative(root, importerFile);
                if (
                  (policy.consumers as readonly string[]).includes(importerRelative)
                ) {
                  return [];
                }
                const importerText = readFileSync(importerFile, "utf8");
                const targetStem = basename(file).replace(/\.[^.]+$/, "");
                if (!importerText.includes(targetStem)) return [];
                const importerSource = ts.createSourceFile(
                  importerFile,
                  importerText,
                  ts.ScriptTarget.Latest,
                  true,
                );
                const importsTarget = [
                  ...sourceRuntimeModuleNames(importerSource),
                ].some(
                  (name) =>
                    resolveLocalModule(root, importerFile, name) === normalize(file),
                );
                return importsTarget
                  ? [
                      `${relative}: config exemption has undeclared importer ${importerRelative}`,
                    ]
                  : [];
              })
            : [];
        return [
          ...(capabilities.size === 0
            ? [`${relative}: exemption has no detected capability`]
            : []),
          ...(hasServerOnlyMarker(source)
            ? [`${relative}: exemption is stale because module is guarded`]
            : []),
          ...([...capabilities].sort().join("\0") ===
          expectedCapabilities.join("\0")
            ? []
            : [
                `${relative}: expected capabilities ${expectedCapabilities.join(", ")}; found ${[...capabilities].sort().join(", ")}`,
              ]),
          ...(!relative.startsWith("lib/") || relative.includes("..")
            ? [`${relative}: exemption target must be an exact lib path`]
            : []),
          ...(["browser", "config"].includes(policy.kind)
            ? []
            : [`${relative}: unsupported exemption kind ${policy.kind}`]),
          ...(metadata.some((value) => value.trim().length === 0)
            ? [`${relative}: exemption metadata must not be empty`]
            : []),
          ...consumerErrors,
          ...undeclaredImporterErrors,
        ];
      },
    );

    const unguarded = [...findings]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, capabilities]) =>
        `${file}: ${[...capabilities].sort().join(", ")}`,
      );
    expect(
      [...unguarded, ...staleExemptions],
      [...unguarded, ...staleExemptions].join("\n"),
    ).toEqual([]);
  }, 120_000);

  it.each([
    ['import { readFile } from "node:fs/promises";', ["node-runtime"]],
    ['const fs = await import("node:fs");', ["node-runtime"]],
    ['const fs = require("fs");', ["node-runtime"]],
    ['import { admin } from "@/lib/supabase";', ["supabase-admin"]],
    ['import { admin } from "@/lib/supabase.ts";', ["supabase-admin"]],
    ['import { admin } from "../../supabase.ts";', ["supabase-admin"]],
    ['import { type SupabaseAdmin } from "@/lib/supabase";', []],
    [
      'export { createClient } from "@supabase/supabase-js";',
      ["supabase-client"],
    ],
    ['export type { Stats } from "node:fs";', []],
    [
      'const { createClient } = await import("@supabase/supabase-js");',
      ["supabase-client"],
    ],
    ['import type { SupabaseClient } from "@supabase/supabase-js";', []],
  ])("detects capabilities from syntax: %s", (code, expected) => {
    const source = ts.createSourceFile(
      "lib/nested/deeper/fixture.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect([...sourceCapabilities(source)].sort()).toEqual(expected);
  });

  it("does not accept a comment or string as the server-only marker", () => {
    const source = ts.createSourceFile(
      "fixture.ts",
      '// import "server-only"\nconst marker = \'import "server-only"\';',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(hasServerOnlyMarker(source)).toBe(false);
  });

  it.each([
    'import type { ServerOnly } from "server-only";',
    'import { type ServerOnly } from "server-only";',
  ])("does not accept an erased marker: %s", (code) => {
    const source = ts.createSourceFile(
      "fixture.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(hasServerOnlyMarker(source)).toBe(false);
  });

  it("resolves alternate relative paths to the canonical local module", () => {
    const root = process.cwd();
    expect(
      resolveLocalModule(
        root,
        join(root, "components", "Fixture.tsx"),
        "../lib/venueIndexTracing.mjs",
      ),
    ).toBe(join(root, "lib", "venueIndexTracing.mjs"));
  });
});
