import type { Venue } from "@/lib/venues";

export function mergeLazyDetailPins(slimPins: Venue[], detailById: Map<string, Venue>): Venue[] {
  const seen = new Set<string>();
  const merged = slimPins.map((pin) => {
    seen.add(pin.id);
    return detailById.get(pin.id) ?? pin;
  });

  for (const [id, venue] of detailById) {
    if (!seen.has(id)) merged.push(venue);
  }

  return merged;
}
