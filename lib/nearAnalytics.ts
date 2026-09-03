import type { NearAnswerSource } from "@/lib/analyticsEvents";

export function nearAnswerReadyProps(source: NearAnswerSource, count: number) {
  return {
    source,
    resultBand: count <= 0 ? "0" : count <= 3 ? "1-3" : "4+",
  } as const;
}

export function nearVenueOpenedProps(source: NearAnswerSource, position: number) {
  return {
    source,
    positionBand: position <= 1 ? "1" : position <= 3 ? "2-3" : "4+",
  } as const;
}
