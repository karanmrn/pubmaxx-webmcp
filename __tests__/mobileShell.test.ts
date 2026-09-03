import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedCrawlState } from "@/lib/crawlUrl";
import { defaultPoiHiddenMobile } from "@/lib/poiToggleGroups";
import {
  MOBILE_MAP_SESSION_KEY,
  readMobileMapSession,
  validateMapViewport,
  validateMobileMapFilters,
  withCityCameraAttitude,
  writeMobileMapSession,
} from "@/lib/mobileShell";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("mobile map session adapter", () => {
  beforeEach(() => {
    (globalThis as { window?: { localStorage: Storage } }).window = {
      localStorage: memoryStorage(),
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips only the versioned safe map state", () => {
    const filters = seedCrawlState("").filters;
    const poiHidden = { ...defaultPoiHiddenMobile(), tube: false, park: false };
    writeMobileMapSession({
      viewport: { center: [-0.12, 51.51], zoom: 13, pitch: 28, bearing: -8 },
      filters,
      cityId: "london",
      nightArea: "shoreditch",
      selectedVenueId: "pub-1",
      poiHidden,
      openSheet: "venue",
    });
    const raw = window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "";
    expect(raw).not.toContain("location");
    expect(readMobileMapSession()).toMatchObject({
      version: 1,
      cityId: "london",
      nightArea: "shoreditch",
      selectedVenueId: "pub-1",
      poiHidden,
      openSheet: "venue",
      filters,
    });
  });

  it("upgrades a session without layer choices and rejects a drifted shape", () => {
    const filters = seedCrawlState("").filters;
    const base = {
      version: 1,
      cityId: "london",
      filters,
      viewport: null,
      nightArea: null,
      selectedVenueId: null,
      openSheet: null,
    };
    // Pre-poiHidden session: restored with null, never discarded.
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify(base));
    expect(readMobileMapSession()).toMatchObject({ cityId: "london", poiHidden: null });
    // Drifted shapes fall back to null rather than restoring a partial map.
    for (const bad of [
      { tube: false },
      { ...defaultPoiHiddenMobile(), tube: "yes" },
      { ...defaultPoiHiddenMobile(), extra: true },
      [],
      "tube",
    ]) {
      window.localStorage.setItem(
        MOBILE_MAP_SESSION_KEY,
        JSON.stringify({ ...base, poiHidden: bad }),
      );
      expect(readMobileMapSession()?.poiHidden).toBeNull();
    }
  });

  it("upgrades a dead-flat saved viewport to the city's designed camera attitude", () => {
    const flat = { center: [-0.12, 51.52] as [number, number], zoom: 12, pitch: 0, bearing: 0 };
    const london = { pitch: 38, bearing: -8 };
    expect(withCityCameraAttitude(flat, london)).toEqual({ ...flat, pitch: 38, bearing: -8 });
    // A user's own rotation or tilt is intent, not artefact: preserved untouched.
    const rotated = { ...flat, bearing: 22 };
    expect(withCityCameraAttitude(rotated, london)).toBe(rotated);
    const tilted = { ...flat, pitch: 12 };
    expect(withCityCameraAttitude(tilted, london)).toBe(tilted);
    // A city designed flat stays flat.
    expect(withCityCameraAttitude(flat, { pitch: 0, bearing: 0 })).toBe(flat);
  });

  it("rejects malformed city, filters, viewport, and overlay data", () => {
    const filters = seedCrawlState("").filters;
    expect(validateMobileMapFilters({ ...filters, stopCount: "six" })).toBeNull();
    expect(validateMapViewport({ center: [500, 51], zoom: 12, pitch: 20, bearing: 0 })).toBeNull();
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify({
      version: 1,
      cityId: "elsewhere",
      filters,
      openSheet: "secrets",
    }));
    expect(readMobileMapSession()).toBeNull();
  });

  it("upgrades saved filters from before subtype lenses and preserves new lenses", () => {
    const current = seedCrawlState("").filters;
    const legacy: Partial<typeof current> = { ...current };
    delete legacy.drinkSubtype;
    delete legacy.topShelfOnly;
    delete legacy.openNow;
    expect(validateMobileMapFilters(legacy)).toMatchObject({
      drinkSubtype: "",
      topShelfOnly: false,
      openNow: false,
    });
    expect(validateMobileMapFilters({
      ...current,
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
      topShelfOnly: true,
      openNow: true,
    })).toMatchObject({
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
      topShelfOnly: true,
      openNow: true,
    });
    expect(validateMobileMapFilters({
      ...current,
      drinkCategory: "rum",
      drinkSubtype: "whisky-japanese",
      topShelfOnly: true,
    })).toMatchObject({
      drinkCategory: "rum",
      drinkSubtype: "",
      topShelfOnly: true,
    });
    expect(validateMobileMapFilters({
      ...current,
      drinkCategory: "",
      drinkSubtype: "",
      topShelfOnly: true,
    })?.topShelfOnly).toBe(false);
  });

  it("drops a restored category the picker can no longer show or clear", () => {
    // A session saved while `other` was still offered must not come back as a
    // filter narrowing the map with nothing on screen to turn it off.
    const current = seedCrawlState("").filters;
    expect(validateMobileMapFilters({
      ...current,
      drinkCategory: "other",
      topShelfOnly: true,
    })).toMatchObject({ drinkCategory: "", topShelfOnly: false });
  });
});
