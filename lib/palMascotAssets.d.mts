export const PAL_MASCOT_SIZES: readonly [32, 64, 128, 512];

export const PAL_MASCOT_WEBP_512_BUDGET: number;

export const PAL_MASCOT_SLUGS: {
  readonly robin: "circuit-robin";
  readonly greyhound: "circuit-greyhound";
  readonly cat: "circuit-cat";
};

/** A species that ships a rendered master. */
export type PalMascotSpecies = keyof typeof PAL_MASCOT_SLUGS;

/** The asset slug a species with a master owns. */
export type PalMascotSlug = (typeof PAL_MASCOT_SLUGS)[PalMascotSpecies];

/** The slug for a species that has a master, or null when it falls back to a rig. */
export function palMascotSlug(species: string): PalMascotSlug | null;

export function palMascotSpeciesList(): PalMascotSpecies[];
