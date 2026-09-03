import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "app/api");
const CERTIFICATION = readFileSync(
  join(ROOT, "docs/WRITE_SURFACE_CERTIFICATION.md"),
  "utf8",
);
const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type MutationMethod = (typeof MUTATION_METHODS)[number];
type MutationHandler = {
  file: string;
  method: MutationMethod;
  route: string;
  source: string;
};

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts" || entry.name === "route.tsx"
        ? [path]
        : [];
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function mutationMethod(name: string | undefined): MutationMethod | null {
  return MUTATION_METHODS.includes(name as MutationMethod) ? name as MutationMethod : null;
}

function routeFromFile(file: string): string {
  return relative(ROOT, file).replace(/\/route\.tsx?$/, "");
}

function mutationHandlersFromSource(source: string, file: string): MutationHandler[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const route = routeFromFile(file);
  const localDeclarations = new Map<string, ts.Node>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      localDeclarations.set(statement.name.text, statement.body);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          localDeclarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  function sourceWithLocalDependencies(root: ts.Node): string {
    const parts: string[] = [];
    const seen = new Set<ts.Node>();
    function visit(node: ts.Node): void {
      if (seen.has(node)) return;
      seen.add(node);
      parts.push(node.getText(sourceFile));
      const referenced = new Set<ts.Node>();
      function collect(child: ts.Node): void {
        if (ts.isIdentifier(child)) {
          const declaration = localDeclarations.get(child.text);
          if (declaration && !seen.has(declaration)) referenced.add(declaration);
        }
        ts.forEachChild(child, collect);
      }
      collect(node);
      for (const declaration of referenced) visit(declaration);
    }
    visit(root);
    return parts.join("\n");
  }

  return sourceFile.statements.flatMap((statement): MutationHandler[] => {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const method = mutationMethod(statement.name?.text);
      return method && statement.body
        ? [{ file, method, route, source: sourceWithLocalDependencies(statement.body) }]
        : [];
    }
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration): MutationHandler[] => {
      const method = ts.isIdentifier(declaration.name)
        ? mutationMethod(declaration.name.text)
        : null;
      return method && declaration.initializer
        ? [{ file, method, route, source: sourceWithLocalDependencies(declaration.initializer) }]
        : [];
    });
  });
}

function mutationHandlerKey(handler: Pick<MutationHandler, "method" | "route">): string {
  return `${handler.method} ${handler.route}`;
}

type Boundary = "rate_limit" | "account" | "capability" | "moderator" | "confirmation" | "session";

// `preparePlanGeneration` is a named delegation: lib/planGeneration.server.ts
// spends the per-IP generation budget before loading planning data.
// `handleProfileImage*` are named delegations: lib/profileImageRoute.server.ts
// owns the ownership gate and the per-actor budget for both image slots, so
// the avatar and cover routes stay one thin call each instead of two copies of
// the same journey. `handleProfileCoverPhoto*` is the same delegation for the
// cover ROTATION (lib/profileCoverPhotoRoute.server.ts): the same ownership
// gate, a per-actor budget on every add, remove and reorder, and a per-actor
// budget on the reader flag.
const BOUNDARY_PATTERNS: Record<Boundary, RegExp> = {
  rate_limit: /\b(?:isLimited|is[A-Z][A-Za-z]+Limited|is[A-Z][A-Za-z]+RateLimited|preparePlanGeneration|handleProfileImage(?:Upload|Delete|Report)|handleProfileCoverPhoto(?:Upload|Delete|Move|Report))\b/,
  account: /\b(?:callerUserId|callerAuthIdentity|verifyCallerAuth|resolveContributionIdentity|requireVerifiedSocialActor|handleProfileImage(?:Upload|Delete)|handleProfileCoverPhoto(?:Upload|Delete|Move))\b/,
  capability: /\b(?:planMemberCapability|memberToken|requireRoundOwnership)\b/,
  moderator: /\b(?:isModerator|isAdminAuthorized|verifyAdminToken)\b/,
  confirmation: /\b(?:consumePublishConfirmation|confirmationToken)\b/,
  session: /\bclearSessionCookie\b/,
};

function boundaries(source: string): Boundary[] {
  return (Object.entries(BOUNDARY_PATTERNS) as [Boundary, RegExp][])
    .filter(([, pattern]) => pattern.test(source))
    .map(([boundary]) => boundary);
}

const mutationHandlers = routeFiles(API_ROOT)
  .flatMap((file) => mutationHandlersFromSource(readFileSync(file, "utf8"), file))
  .sort((first, second) => mutationHandlerKey(first).localeCompare(mutationHandlerKey(second)));

function certifiedMutationHandlers(): string[] {
  const block = CERTIFICATION.match(
    /<!-- mutation-handler-inventory:start -->[\s\S]*?<!-- mutation-handler-inventory:end -->/,
  )?.[0] ?? "";
  return [...block.matchAll(/^- `((?:POST|PUT|PATCH|DELETE) app\/api\/[^`]+)`$/gm)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .sort();
}

describe("mutating API surface certification", () => {
  it("documents account-derived Visit Report and Recommendation identity", () => {
    const visitReports = CERTIFICATION.match(
      /### `app\/api\/visit-reports`[\s\S]*?(?=\n### )/,
    )?.[0] ?? "";
    const recommendations = CERTIFICATION.match(
      /### `app\/api\/weather-recommendations`[\s\S]*?(?=\n### |\s*$)/,
    )?.[0] ?? "";

    expect(visitReports).toMatch(
      /authenticated\s+account's immutable profile id/,
    );
    expect(visitReports).toMatch(
      /visit-report:\$\{contributor\.actor\}:\$\{ipHash\}/,
    );
    expect(visitReports).not.toMatch(/per-handle|self-asserted handle/);
    expect(recommendations).toMatch(
      /authenticated account's\s+immutable profile id/,
    );
    expect(recommendations).toMatch(/profile-based actor/);
    expect(recommendations).not.toMatch(/Keyless development|asserted handle/);
  });

  it("keeps the reviewed inventory explicit", () => {
    // Each mutation method is one coordination point. Exact path and method
    // pairs live in docs/WRITE_SURFACE_CERTIFICATION.md.
    expect(mutationHandlers).toHaveLength(142);
    expect(certifiedMutationHandlers()).toEqual(
      mutationHandlers.map(mutationHandlerKey),
    );
  });

  it("certifies both verified Social post write routes", () => {
    const create = CERTIFICATION.match(
      /### `app\/api\/social\/posts`[\s\S]*?(?=\n### )/,
    )?.[0] ?? "";
    const item = CERTIFICATION.match(
      /### `app\/api\/social\/posts\/\[postId\]`[\s\S]*?(?=\n### |\s*$)/,
    )?.[0] ?? "";

    for (const section of [create, item]) {
      expect(section).toMatch(/verified Social actor/i);
      expect(section).toMatch(/stable profile/i);
      expect(section).toMatch(/account ID/i);
    }
    expect(create).toMatch(/pending moderation/i);
    expect(item).toMatch(/recoverable/i);
  });

  it("certifies the consolidated verified Social interaction route", () => {
    const section = CERTIFICATION.match(
      /### `app\/api\/social\/interactions`[\s\S]*?(?=\n### |\s*$)/,
    )?.[0] ?? "";
    expect(section).toMatch(/verified Social actor/i);
    expect(section).toMatch(/stable profile/i);
    expect(section).toMatch(/desired state/i);
    expect(section).toMatch(/private saves/i);
    expect(section).toMatch(/held moderation/i);
    expect(section).toMatch(/named staff/i);
    expect(section).toMatch(/safety floors\s+stay\s+open/i);
  });

  it("certifies every verified Social Crew membership route", () => {
    const section = CERTIFICATION.match(
      /### Social Crew authority routes[\s\S]*?(?=\n### `app\/api\/push-tokens`)/,
    )?.[0] ?? "";
    const routes = [
      "app/api/social/crews",
      "app/api/social/crews/[crewId]",
      "app/api/social/crews/[crewId]/invitations",
      "app/api/social/crews/[crewId]/invitations/[invitationId]",
      "app/api/social/crews/[crewId]/join-requests",
      "app/api/social/crews/[crewId]/join-requests/[requestId]",
      "app/api/social/crews/[crewId]/members/[memberId]",
      "app/api/social/crews/[crewId]/leave",
    ];

    for (const route of routes) expect(section).toContain(`\`${route}\``);
    expect(section).toMatch(/verified Social actor/i);
    expect(section).toMatch(/Idempotency-Key/);
    expect(section).toMatch(/16 to 128/);
    expect(section).toMatch(/private, no-store/);
    expect(section).toMatch(/401[\s\S]*403[\s\S]*404[\s\S]*409[\s\S]*422[\s\S]*429[\s\S]*503/);
    expect(section).toMatch(/creation alone[\s\S]*Authorization/i);
    expect(section).toMatch(/unknown keys/i);
  });

  it("enumerates synchronous handlers and checks sibling boundaries independently", () => {
    const fixture = `
      export async function POST() {
        await requireVerifiedSocialActor();
        return save();
      }
      export function DELETE() {
        return remove();
      }
    `;
    const handlers = mutationHandlersFromSource(
      fixture,
      join(ROOT, "app/api/fixture/route.ts"),
    );

    expect(handlers.map(mutationHandlerKey)).toEqual([
      "POST app/api/fixture",
      "DELETE app/api/fixture",
    ]);
    expect(boundaries(handlers[0]?.source ?? "")).toContain("account");
    expect(boundaries(handlers[1]?.source ?? "")).toEqual([]);
  });

  it("gives every mutating handler its own abuse or authority boundary", () => {
    const uncovered = mutationHandlers
      .filter(({ source }) =>
        boundaries(source).length === 0,
      )
      .map(mutationHandlerKey);

    expect(uncovered).toEqual([]);
  });

  it("fails closed around anonymous paid spend and Plan creation", () => {
    const failClosedRoutes = [
      "app/api/concierge/route.ts",
      "app/api/heritage/route.ts",
      "app/api/plans/route.ts",
    ];

    for (const route of failClosedRoutes) {
      const source = readFileSync(join(ROOT, route), "utf8");
      expect(source, route).toMatch(/failClosed:\s*true/);
    }
  });

  it("keeps Plan lifecycle writes capability-bound and idempotent", () => {
    const planMutationRoutes = mutationHandlers.filter(({ route }) =>
      route.startsWith("app/api/plans/[id]/")
      && !route.endsWith("/presence")
      && !route.endsWith("/session"),
    );

    const violations = planMutationRoutes
      .filter(({ source }) => !/\b(?:planMemberCapability|memberToken)\b/.test(source))
      .map(({ route }) => route);

    expect(violations).toEqual([]);
  });
});
