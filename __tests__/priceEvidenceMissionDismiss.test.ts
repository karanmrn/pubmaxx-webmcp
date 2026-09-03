import { describe, expect, it } from "vitest";

import {
  dismissPriceEvidenceMission,
  PRICE_EVIDENCE_MISSION_DISMISS_KEY,
  readDismissedMissions,
} from "@/lib/priceEvidenceMissionDismiss";
import { priceEvidenceMissionKey } from "@/lib/priceEvidenceMissions";

function memoryStorage(seed?: string): Storage {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set(PRICE_EVIDENCE_MISSION_DISMISS_KEY, seed);
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("price evidence mission dismissal", () => {
  it("lasts only as long as the supplied session storage", () => {
    const storage = memoryStorage();
    const mission = {
      venueId: "venue-live",
      reason: "provisional" as const,
      drinkCategory: "beer" as const,
    };
    const dismissed = dismissPriceEvidenceMission(mission, storage);
    expect(dismissed.has(priceEvidenceMissionKey(mission))).toBe(true);
    expect(readDismissedMissions(storage).has(priceEvidenceMissionKey(mission))).toBe(true);
    expect(readDismissedMissions(memoryStorage()).size).toBe(0);
  });

  it("treats a missing or malformed store as nobody dismissed", () => {
    expect(readDismissedMissions(null).size).toBe(0);
    expect(readDismissedMissions(memoryStorage("not-json")).size).toBe(0);
    expect(readDismissedMissions(memoryStorage("{\"oops\":true}")).size).toBe(0);
  });
});
