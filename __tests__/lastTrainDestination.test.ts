import { describe, expect, it } from "vitest";

import {
  lastTrainFetchUrl,
  LAST_TRAIN_DESTINATION_KEY,
  normalizeLastTrainDestination,
  readLastTrainDestination,
  writeLastTrainDestination,
} from "@/lib/lastTrainDestination";

function mockStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } as Storage;
}

describe("lastTrainDestination", () => {
  it("normalizes and caps destination labels", () => {
    expect(normalizeLastTrainDestination("  Home station  ")).toBe("Home station");
    expect(normalizeLastTrainDestination("a".repeat(100)).length).toBe(80);
  });

  it("reads and writes session-only destination labels", () => {
    const storage = mockStorage();
    expect(readLastTrainDestination(storage)).toBe("");
    writeLastTrainDestination("High Barnet", storage);
    expect(readLastTrainDestination(storage)).toBe("High Barnet");
    expect(storage.getItem(LAST_TRAIN_DESTINATION_KEY)).toBe("High Barnet");
    writeLastTrainDestination("", storage);
    expect(readLastTrainDestination(storage)).toBe("");
    expect(storage.getItem(LAST_TRAIN_DESTINATION_KEY)).toBeNull();
  });

  it("builds fetch URLs without destination (client-only privacy)", () => {
    const url = lastTrainFetchUrl(51.50741234, -0.12785678);
    expect(url).toBe("/api/last-train?lat=51.507&lng=-0.128");
    expect(url).not.toContain("destination");
  });
});

describe("lastTrainRequestKey city scoping", () => {
  it("includes cityId so London and Manchester do not share cache keys", async () => {
    const { lastTrainRequestKey } = await import("@/components/map/LastTrainCard");
    expect(
      lastTrainRequestKey({ lat: 53.48, lng: -2.24, venueName: "Pub", cityId: "manchester" }),
    ).toContain("manchester");
    expect(lastTrainRequestKey({ lat: 51.5, lng: -0.12, venueName: "Pub" })).toContain("london");
  });
});
