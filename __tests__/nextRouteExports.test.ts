import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appRoot = join(root, "app");

const ALLOWED_ROUTE_VALUE_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "config",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration",
  "generateStaticParams",
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" || entry.name === "route.tsx" ? [path] : [];
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true;
}

function collectBindingNames(name: ts.BindingName, names: string[]): void {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
  }
}

function exportedValueNames(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause) {
        names.push("<export-star>");
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        names.push(statement.exportClause.name.text);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.push(element.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.push("<export-assignment>");
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (hasDefaultModifier(statement)) {
      names.push("<default>");
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
      continue;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      names.push(statement.name.text);
    }
  }

  return names;
}

describe("Next route module exports", () => {
  it("keeps runtime values inside Next's supported route export contract", () => {
    const invalid = routeFiles(appRoot).flatMap((file) =>
      exportedValueNames(file)
        .filter((name) => !ALLOWED_ROUTE_VALUE_EXPORTS.has(name))
        .map((name) => `${file.slice(root.length + 1)}:${name}`),
    );

    expect(invalid).toEqual([]);
  });

  it("fails closed for indirect, default, assignment, and destructured value exports", () => {
    const directory = mkdtempSync(join(tmpdir(), "pubmax-route-exports-"));
    const file = join(directory, "route.ts");
    writeFileSync(file, [
      'export * from "./helpers";',
      "export const { helper } = source;",
      "export default function GET() {}",
      "export = handler;",
    ].join("\n"));

    try {
      expect(exportedValueNames(file)).toEqual([
        "<export-star>",
        "helper",
        "<default>",
        "<export-assignment>",
      ]);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
