// npm audit that fails on real high/critical vulnerabilities but tolerates
// primary registry outages. Plain `npm audit` exits non-zero for BOTH findings
// and infrastructure errors (e.g. the advisory endpoint returning 503), which
// turns an npm-registry incident into a build failure with zero signal.
// Here: findings -> exit 1; primary registry/endpoint failure -> warn + exit 0.
// Once a waiver is needed, an unavailable production-only audit fails closed
// because the waiver's dev-only scope cannot be proven.
//
// A finding may additionally be WAIVED, but only under the narrow terms in
// WAIVED_ADVISORIES below: one named advisory, dev dependencies only, and
// only while a second `npm audit --omit=dev` run proves production is clean.
// Anything else - a new advisory, a new severity, the same advisory reaching a
// production dependency - still fails the gate.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const AUDIT_LEVELS = ["high", "critical"];

// Advisories knowingly tolerated, keyed by GitHub advisory URL.
// Empty on purpose after the eslint 10 bump removed the only prior entry
// (GHSA-mh99-v99m-4gvg via eslint 9 -> minimatch@3 -> brace-expansion@1).
// Add an entry only after upgrades and overrides are exhausted; never raise
// --audit-level or omit dev deps to hide a finding. Each entry needs an
// inline rationale and a removal condition, and only while a second
// production-only audit proves the chain is dev-only.
export const WAIVED_ADVISORIES = new Map();

function runAudit(extraArgs = []) {
  const result = spawnSync("npm", ["audit", "--json", "--audit-level=high", ...extraArgs], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  let report = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    report = null;
  }
  return { result, stdout, report };
}

function hasVulnerabilities(report) {
  return Boolean(report && report.metadata && report.metadata.vulnerabilities);
}

// `via` holds either advisory objects (the root cause) or the names of other
// vulnerable packages. Walk the names to reach every advisory behind an entry.
function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = vulnerabilities[name];
  if (!entry) return [];
  const advisories = [];
  for (const via of entry.via ?? []) {
    if (typeof via === "string") {
      advisories.push(...collectAdvisories(via, vulnerabilities, seen));
    } else if (via && via.url) {
      advisories.push(via);
    }
  }
  return advisories;
}

// Split a report's high/critical entries into the ones every advisory behind
// them is waived for, and the ones that must still fail the gate.
export function classifyFindings(report, waived = WAIVED_ADVISORIES) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const waivedNames = [];
  const unwaivedNames = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!AUDIT_LEVELS.includes(entry.severity)) continue;
    const advisories = collectAdvisories(name, vulnerabilities);
    const fullyWaived =
      advisories.length > 0 && advisories.every((a) => waived.get(a.url) === a.severity);
    (fullyWaived ? waivedNames : unwaivedNames).push(name);
  }
  return { waived: waivedNames, unwaived: unwaivedNames };
}

function main() {
  const { result, stdout, report } = runAudit();

  if (hasVulnerabilities(report)) {
    const counts = report.metadata.vulnerabilities;
    const flagged = AUDIT_LEVELS.reduce((n, level) => n + (counts[level] ?? 0), 0);

    if (flagged === 0) {
      console.log("[resilient-audit] no high/critical vulnerabilities.");
      return 0;
    }

    const { waived, unwaived } = classifyFindings(report);

    if (unwaived.length > 0) {
      console.error(
        `[resilient-audit] ${unwaived.length} unwaived high/critical vulnerabilities: ${unwaived.join(", ")}`,
      );
      process.stdout.write(stdout);
      return 1;
    }

    // Everything flagged is waived, but a waiver only covers dev dependencies.
    // Re-audit production-only and fail if the same advisory reaches shipped code.
    const prod = runAudit(["--omit=dev"]);
    if (!hasVulnerabilities(prod.report)) {
      console.error(
        "[resilient-audit] cannot confirm the waived advisories are dev-only (production audit unavailable) - failing closed.",
      );
      process.stdout.write(stdout);
      return 1;
    }
    const prodCounts = prod.report.metadata.vulnerabilities;
    const prodFlagged = AUDIT_LEVELS.reduce((n, level) => n + (prodCounts[level] ?? 0), 0);
    if (prodFlagged > 0) {
      console.error(
        `[resilient-audit] ${prodFlagged} high/critical vulnerabilities in PRODUCTION dependencies - waivers are dev-only.`,
      );
      process.stdout.write(prod.stdout);
      return 1;
    }

    console.log(
      `[resilient-audit] no unwaived high/critical vulnerabilities. Waived (dev-only, see WAIVED_ADVISORIES): ${waived.join(", ")}`,
    );
    return 0;
  }

  // No parseable report: npm itself failed (registry outage, ENOAUDIT, proxy).
  // The audit is advisory infrastructure, so do not fail the build on its absence.
  const stderr = (result.stderr ?? "").slice(0, 2000);
  console.warn("[resilient-audit] audit unavailable (registry/endpoint error) - skipping as advisory.");
  if (stderr) console.warn(stderr);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
