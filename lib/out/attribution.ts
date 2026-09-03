import type { WhatsOnRow } from "@/lib/whatsOn";

export const OUT_CARD_SOURCES = ["ticketmaster", "skiddle", "common", "venue"] as const;
export type OutCardSource = (typeof OUT_CARD_SOURCES)[number];

export type OutSourceCredit = {
  label: string;
  logoRequired: boolean;
  url: string;
};

const SKIDDLE_HOME = "https://www.skiddle.com/";
const TICKETMASTER_HOME = "https://www.ticketmaster.co.uk/";
const COMMON_HOME = "https://www.common-social.com/";

// The Skiddle fence lives in lib/whatson/eventNormalise.mjs, which both supply
// lanes read. It is deliberately NOT re-exported here: this module is reached
// from app/out/OutClient.tsx ("use client"), and a re-export is not shaken out
// of a module the bundler treats as side-effectful, so it would drag the whole
// normaliser and the city bounds into the browser bundle for a symbol no
// client reads.

export function outCardSource(label: string): OutCardSource {
  const normalised = label.trim().toLowerCase();
  if (normalised === "ticketmaster") return "ticketmaster";
  if (normalised === "skiddle") return "skiddle";
  if (normalised === "common") return "common";
  return "venue";
}

// How a publisher is SPELLED, in one place. A row carries the label its own
// lane wrote down ("common"), and matching stays case-insensitive through
// outCardSource, so nothing depends on the spelling - but a reader sees these
// three names side by side and one of them may not arrive in lower case.
// A venue's own listing keeps its own name, which is not ours to restyle.
const SOURCE_DISPLAY_LABELS: Record<Exclude<OutCardSource, "venue">, string> = {
  ticketmaster: "Ticketmaster",
  skiddle: "Skiddle",
  common: "Common",
};

export function outSourceDisplayLabel(label: string): string {
  const key = outCardSource(label);
  return key === "venue" ? label : SOURCE_DISPLAY_LABELS[key];
}

export function outSourceAttributionFromLabels(labels: readonly string[]): OutSourceCredit[] {
  const seen = new Map<OutCardSource, OutSourceCredit>();
  for (const label of labels) {
    const key = outCardSource(label);
    if (seen.has(key)) continue;
    if (key === "skiddle") {
      seen.set(key, { label: SOURCE_DISPLAY_LABELS.skiddle, logoRequired: true, url: SKIDDLE_HOME });
    } else if (key === "ticketmaster") {
      seen.set(key, {
        label: SOURCE_DISPLAY_LABELS.ticketmaster,
        logoRequired: false,
        url: TICKETMASTER_HOME,
      });
    } else if (key === "common") {
      seen.set(key, { label: SOURCE_DISPLAY_LABELS.common, logoRequired: false, url: COMMON_HOME });
    }
  }
  return [...seen.values()];
}

export function outSourceAttribution(rows: readonly WhatsOnRow[]): OutSourceCredit[] {
  return outSourceAttributionFromLabels(rows.map((row) => row.source.label));
}
