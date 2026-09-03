// Pure merge for the What's-On serving spine: durable official-API rows win on
// identity, and the bundled files fill gaps. Expired rows never leave this
// function, so a store that still holds last week's gig cannot reach a Tonight
// card.

import { dedupeKey, dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import { skiddleLaneFenced } from "@/lib/whatson/eventNormalise.mjs";
import { eventIdentityKey } from "@/lib/whatsOnRowShape.mjs";

function providerKey(label: string): string {
  return label.trim().toLocaleLowerCase("en-GB");
}

export function isServableWhatsOnRow(row: WhatsOnRow): boolean {
  return !(skiddleLaneFenced() && providerKey(row.source.label) === "skiddle");
}

export function preferDurableWhatsOn(
  durable: WhatsOnRow[],
  bundled: WhatsOnRow[],
  now: number,
): WhatsOnRow[] {
  const durableRows = dedupeRows(filterNotPast(durable, now).filter(isServableWhatsOnRow));
  const durableKeys = new Set(durableRows.map(dedupeKey));
  const bundledRows = dedupeRows(
    filterNotPast(bundled, now).filter(isServableWhatsOnRow),
  );
  const bundledVenueByIdentity = new Map<string, string>();
  for (const row of bundledRows) {
    const identity = eventIdentityKey(row);
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    if (identity && venueId && !bundledVenueByIdentity.has(identity)) {
      bundledVenueByIdentity.set(identity, venueId);
    }
  }
  const enrichedDurableRows = durableRows.map((row) => {
    if (typeof row.venueId === "string" && row.venueId.trim()) return row;
    const identity = eventIdentityKey(row);
    const venueId = identity ? bundledVenueByIdentity.get(identity) : undefined;
    return venueId ? { ...row, venueId } : row;
  });
  return [
    ...enrichedDurableRows,
    ...bundledRows.filter((row) => !durableKeys.has(dedupeKey(row))),
  ];
}
