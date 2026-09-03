// The Pub Pal species that ship a rendered master, and the asset slug each owns.
//
// Two consumers need the SAME table and cannot share a TypeScript module: the
// app's mascot reader (lib/pubPalMascot.ts) and the asset generator
// (scripts/gen-pubpal-mascot.mjs), which runs outside the bundler. Plain ESM,
// no imports, matching lib/brandMark.mjs and lib/pintIndexCanonical.mjs.
//
// A species ABSENT from this table has no master, so every surface falls back to
// its layered-SVG rig. That is the whole rule, and it is why nothing else in the
// tree may branch on a species name to decide which artwork to draw: adding art
// is adding a row here and naming the same slug as that species' `format` in
// lib/pubPal.ts, and removing art is removing the row.

export const PAL_MASCOT_SIZES = [32, 64, 128, 512];

// A 512 square is the largest rendition any surface asks for, so it is the one
// that has to stay cheap on a phone.
export const PAL_MASCOT_WEBP_512_BUDGET = 60 * 1024;

export const PAL_MASCOT_SLUGS = {
  robin: "circuit-robin",
  greyhound: "circuit-greyhound",
  cat: "circuit-cat",
};

export function palMascotSlug(species) {
  if (typeof species !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PAL_MASCOT_SLUGS, species)
    ? PAL_MASCOT_SLUGS[species]
    : null;
}

export function palMascotSpeciesList() {
  return Object.keys(PAL_MASCOT_SLUGS);
}
