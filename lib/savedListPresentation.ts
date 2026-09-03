export function formatSavedVenueCount(count: number): string {
  return `${count} ${count === 1 ? "venue" : "venues"}`;
}
