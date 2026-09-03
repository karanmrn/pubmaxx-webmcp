export function canonicalOutVenueId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const venueId = value.trim();
  return venueId.length > 0 ? venueId : null;
}
