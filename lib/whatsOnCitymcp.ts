// CityMCP → What's-On row mapping. Split from lib/whatsOn.ts so the map shell
// chunk does not static-import lib/citymcp/client on cold open.

import type { ThingsToDoResult } from "@/lib/citymcp/client";
import {
  dedupeRows,
  isHttpUrl,
  isValidIso,
  isValidObservedAt,
  isValidWhatsOnRow,
  normaliseEventTitle,
  normaliseSourceLabel,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const THINGS_TO_DO_KIND_MAP: Record<string, WhatsOnKind> = {
  gig: "music",
  nightlife: "music",
  food_drink: "deal",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export type MapThingsToDoOpts = {
  now: number;
};

/** Map trimmed CityMCP opportunities to WhatsOnRow[] with confidence "listed". */
export function mapThingsToDoToRows(
  result: ThingsToDoResult,
  opts: MapThingsToDoOpts,
): WhatsOnRow[] {
  const providerObservedAt = isValidObservedAt(result.asOf, opts.now)
    ? new Date(Date.parse(result.asOf as string)).toISOString()
    : null;
  const observedAt = providerObservedAt ?? new Date(opts.now).toISOString();
  const rows: WhatsOnRow[] = [];
  for (const opp of result.opportunities) {
    const kind = opp.kind ? THINGS_TO_DO_KIND_MAP[opp.kind] : undefined;
    if (!kind) continue;
    const placeName = opp.place?.name;
    if (!isNonEmptyString(placeName)) continue;
    const label = opp.source?.label;
    const url = opp.source?.url;
    if (!isNonEmptyString(label) || !isHttpUrl(url)) continue;

    const rawStart = opp.startsAt;
    const startsAt = isValidIso(rawStart) ? (rawStart as string) : undefined;
    const timeEvidence = isNonEmptyString(opp.timeEvidence) ? opp.timeEvidence : undefined;

    const detailBits: string[] = [];
    if (timeEvidence) detailBits.push(`Listed time: ${timeEvidence}`);
    if (isNonEmptyString(opp.price)) detailBits.push(opp.price);

    const row: WhatsOnRow = {
      id: stableId(
        "whats-live",
        `${placeName}|${kind}|${startsAt ?? timeEvidence ?? opp.title}|${opp.title}`,
      ),
      placeName,
      kind,
      title: normaliseEventTitle(opp.title),
      source: { label: normaliseSourceLabel(label), url: url as string },
      observedAt,
      confidence: "listed",
      listedWindow: result.window,
    };
    if (startsAt) row.startsAt = startsAt;
    if (timeEvidence) row.timeEvidence = timeEvidence;
    if (opp.place?.location) {
      row.lat = opp.place.location.lat;
      row.lng = opp.place.location.lng;
    }
    if (detailBits.length > 0) row.detail = detailBits.join(" · ");

    if (isValidWhatsOnRow(row, opts.now)) rows.push(row);
  }
  return dedupeRows(rows);
}
