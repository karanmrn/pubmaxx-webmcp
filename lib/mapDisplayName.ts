/**
 * What one map is called, decided once. A place arrival names itself, an
 * explicit UK browse is the country, and everything else is the city. The held
 * loading frame and the live map both ask this, so a skeleton can never name a
 * different map from the one it is about to become.
 */
export function resolveMapDisplayName(input: {
  placeName?: string | null;
  ukNationalBrowse?: boolean;
  cityDisplayName: string;
}): string {
  const place = input.placeName?.trim();
  if (place) return place;
  if (input.ukNationalBrowse) return "UK";
  return input.cityDisplayName;
}
