#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(process.argv[2] ?? "e2e");

async function filesUnder(entry) {
  const info = await stat(entry);
  if (info.isFile()) return [entry];

  const files = [];
  for (const name of await readdir(entry)) {
    const child = path.join(entry, name);
    const childInfo = await stat(child);
    if (childInfo.isDirectory()) files.push(...(await filesUnder(child)));
    else if (/\.spec\.[cm]?[jt]sx?$/.test(name)) files.push(child);
  }
  return files;
}

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function skipCallKind(expression) {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const method = expression.name.text;
  if (method !== "skip" && method !== "fixme") return null;

  const owner = expression.expression;
  if (ts.isIdentifier(owner) && owner.text === "test") return method;
  if (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "describe" &&
    ts.isIdentifier(owner.expression) &&
    owner.expression.text === "test"
  ) {
    return `describe.${method}`;
  }
  return null;
}

function isIntentionalProjectGate(file, expression) {
  const compact = expression.replace(/\s+/g, " ").trim();
  if (/^\(*!process\.env\.[A-Z0-9_]+\)*$/.test(compact)) return true;
  if (
    path.basename(file) === "screenshots.spec.ts" &&
    /^(?:!?isDesktop|isDesktop \|\| viewportName !== ["']390["'])$/.test(compact)
  ) {
    return true;
  }
  return false;
}

let files;
try {
  files = await filesUnder(root);
} catch (error) {
  console.error(
    `conditional skip scan failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

if (files.length === 0) {
  console.error(`conditional skip scan failed: no E2E specs found under ${root}`);
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const kind = skipCallKind(node.expression);
      if (kind) {
        const argument = node.arguments[0];
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        let expression = argument?.getText(sourceFile) ?? "missing condition";
        const staticDeclaration =
          !argument ||
          ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument) ||
          kind.startsWith("describe.");
        if (staticDeclaration) expression = "static skipped declaration";

        if (staticDeclaration || !isIntentionalProjectGate(file, expression)) {
          findings.push({
            file: path.relative(process.cwd(), file),
            line: position.line + 1,
            kind,
            expression: expression.replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}: ${finding.kind} depends on ${finding.expression}`,
    );
  }
  console.error(`conditional skip scan failed: ${findings.length} finding(s)`);
  process.exit(1);
}

console.log(`conditional skip scan passed: ${files.length} spec file(s)`);
