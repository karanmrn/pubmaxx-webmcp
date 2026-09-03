// Which registry artifacts a freshness serverless function has to carry.
//
// Two kinds of dataset are opened at runtime, and they are exactly the two this
// traces (lib/freshness.ts datasetOpensArtifact draws the same line):
//   • `{ stamp: { kind: "field" } }` — the stamp lives inside the artifact.
//   • `{ pack: true }` — the artifact is a row pack whose presence and
//     non-emptiness IS the finding, whatever kind of stamp dates it. Leaving a
//     pack untraced makes that finding unreachable in production: the file is
//     simply not in the function, so the reader answers the registry's literal
//     stamp and reports the feed fresh.
// A literal stamp on its own is answered from the registry and a dataset with no
// stamp is never dated at all (resolveStamp returns before it looks at the
// read). Tracing the rest would push megabytes of unrelated payload into both
// functions for nothing — the same bloat that ruled out a public/data/**/*.json
// glob.
//
// Plain ESM with no imports so next.config.mjs can call it while Next loads the
// config, and __tests__/freshnessTracing.test.ts can drive it with a synthetic
// registry to prove a newly field-stamped dataset is traced with no edit here.

/**
 * @param {{ datasets?: ReadonlyArray<{ artifact?: string | null, pack?: boolean, stamp?: { kind?: string } | null }> }} registry
 * @returns {string[]} `./`-relative paths for Next's outputFileTracingIncludes.
 */
export function freshnessArtifactIncludes(registry) {
  return (registry?.datasets ?? []).flatMap((dataset) => {
    if (!dataset?.artifact) return [];
    const opened = dataset.stamp?.kind === "field" || dataset.pack === true;
    return opened ? [`./${dataset.artifact}`] : [];
  });
}

/**
 * ONE registered artifact, for a route that opens that dataset at request time
 * and nothing else (the feed's sourced-price overlay). Taken from the registry
 * by id so the path a function ships and the path the spine ages stay the same
 * string, and an unknown id is [] rather than a guess.
 *
 * @param {{ datasets?: ReadonlyArray<{ id?: string, artifact?: string | null }> }} registry
 * @param {string} id
 * @returns {string[]} `./`-relative path for Next's outputFileTracingIncludes.
 */
export function freshnessArtifactIncludeById(registry, id) {
  const dataset = (registry?.datasets ?? []).find((entry) => entry?.id === id);
  return dataset?.artifact ? [`./${dataset.artifact}`] : [];
}
