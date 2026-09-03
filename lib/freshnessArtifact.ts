// The one disk read behind the freshness spine, shared by /api/freshness and the
// freshness-audit cron so both routes answer identically.
//
// It reports WHAT it found, not just the JSON: a path that is not there and a
// path that is there but unparseable are different defects, and the audit is
// only actionable if it can say which. That distinction is the whole reason this
// module exists — the old inline reader collapsed both to `undefined`, so every
// feed produced the same unactionable "none could be resolved" line.
//
// A note on why a file can be missing at runtime at all: these paths come from
// data/freshness_registry.json and are joined to process.cwd() at request time,
// so Next's file tracing cannot see them. They are declared explicitly in
// next.config.mjs `outputFileTracingIncludes` for both routes; without that, the
// artifacts only reach a function by accident of Vercel's lambda grouping.

import "server-only";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  datasetOpensArtifact,
  packArtifactReason,
  resolveStamp,
  stampNeedsArtifact,
  type ArtifactRead,
  type FreshnessDataset,
  type StampResolution,
} from "@/lib/freshness";

export function readFreshnessArtifact(rootDir: string, relPath: string | null): ArtifactRead {
  if (!relPath) return { kind: "absent" };
  const abs = join(/* turbopackIgnore: true */ rootDir, relPath);
  if (!existsSync(/* turbopackIgnore: true */ abs)) {
    return { kind: "missing", path: relPath };
  }
  try {
    return {
      kind: "ok",
      path: relPath,
      json: JSON.parse(
        readFileSync(/* turbopackIgnore: true */ abs, "utf8"),
      ),
    };
  } catch (err) {
    return {
      kind: "unreadable",
      path: relPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The one way a route turns a dataset into its stamp. Only a field stamp lives
 * inside the artifact, so only a field stamp opens one: a literal stamp is
 * answered from the registry and an unstamped dataset is never dated, and
 * parsing multi-megabyte JSON to discard it would cost every request for
 * nothing. The single exception is a declared PACK, which is opened whatever
 * dates it because its rows ARE the finding, and which the tracing config ships
 * for exactly that reason. Both freshness readers go through here so neither
 * can drift.
 */
export function resolveDatasetStamp(
  rootDir: string,
  dataset: Pick<FreshnessDataset, "stamp" | "artifact" | "pack">,
  read: (rootDir: string, relPath: string | null) => ArtifactRead = readFreshnessArtifact,
): StampResolution {
  const artifactRead = datasetOpensArtifact(dataset)
    ? read(rootDir, dataset.artifact)
    : ({ kind: "absent" } as const);
  // The pack judgement runs whatever the read was, INCLUDING the absent one a
  // pack with no declared artifact produces. Short-circuiting before this is
  // how the two readers came to disagree about that registry mistake, and they
  // disagreed in the dangerous direction: the app answered the literal stamp
  // and reported the feed fresh forever while the CLI gate failed the build.
  if (dataset.pack === true) {
    const packReason = packArtifactReason(artifactRead);
    if (packReason) return { observedAt: null, reason: packReason };
  }
  return resolveStamp(
    dataset.stamp,
    stampNeedsArtifact(dataset.stamp) ? artifactRead : { kind: "absent" },
  );
}
