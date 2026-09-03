export function freshnessArtifactIncludes(registry: {
  datasets?: readonly {
    readonly artifact?: string | null;
    readonly stamp?: { readonly kind?: string } | null;
  }[];
}): string[];

export function freshnessArtifactIncludeById(
  registry: {
    datasets?: readonly {
      readonly id?: string;
      readonly artifact?: string | null;
    }[];
  },
  id: string,
): string[];
