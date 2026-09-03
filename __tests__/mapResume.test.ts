import { describe, expect, it } from "vitest";

import {
  isCurrentMapResumeRefresh,
  isPersistableMapResumeViewport,
  readMapResumeSync,
  writeMapResume,
} from "@/lib/mapResume";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const value = {
  cityId: "london" as const,
  viewport: { center: [-0.12, 51.52] as [number, number], zoom: 15, pitch: 38, bearing: -8 },
  rows: [{ id: "venue-1", name: "Test pub", lat: 51.52, lng: -0.12, borough: "Camden", cheapestPrice: 5 }],
};

describe("map resume", () => {
  it("rejects the neutral hold viewport until location and camera settle", () => {
    const hold = { center: [0, 0] as [number, number], zoom: 0, pitch: 0, bearing: 0 };
    expect(isPersistableMapResumeViewport(hold, false, false)).toBe(false);
    expect(isPersistableMapResumeViewport(hold, true, true)).toBe(false);
    expect(isPersistableMapResumeViewport(value.viewport, true, true)).toBe(true);
  });

  it("mirrors a valid snapshot for synchronous warm paint", () => {
    const store = storage();
    writeMapResume(value, 1_000, store);
    expect(readMapResumeSync("london", 1_000, store)).toMatchObject(value);
  });

  it("ignores malformed synchronous snapshots", () => {
    const store = storage();
    store.setItem("map-resume:v1:london", "broken");
    expect(readMapResumeSync("london", 1_000, store)).toBeNull();
  });

  it("allows resume refresh after unavailable live loading", () => {
    expect(isCurrentMapResumeRefresh("pending", false, 4, 4)).toBe(true);
    expect(isCurrentMapResumeRefresh("unavailable", false, 4, 4)).toBe(true);
    expect(isCurrentMapResumeRefresh("unavailable", true, 4, 4)).toBe(false);
    expect(isCurrentMapResumeRefresh("ready", true, 4, 4)).toBe(false);
    expect(isCurrentMapResumeRefresh("pending", false, 5, 4)).toBe(false);
  });
});
