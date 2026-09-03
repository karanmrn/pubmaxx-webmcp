import { describe, expect, it } from "vitest";

import {
  MAP_CHOSEN_AREA_KEY,
  clearMapChosenArea,
  mapChosenAreaFlyTarget,
  mapChosenAreaPickerKind,
  rememberMapChosenAreaSelection,
  readMapChosenArea,
  resolveMapChosenAreaRestore,
  writeMapChosenArea,
  type MapChosenArea,
} from "@/lib/mapChosenArea";
import { LOCALITY_FLY_ZOOM } from "@/lib/mapSearchSuggest";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("mapChosenArea", () => {
  it("replaces a stale remembered area when search selects a named area", () => {
    const storage = makeMemoryStorage();
    const remembered = {
      cityId: "london" as const,
      label: "Piccadilly & Soho",
      slug: "piccadilly-soho",
      center: [-0.134, 51.511] as [number, number],
      kind: "night-area" as const,
    } satisfies MapChosenArea;
    writeMapChosenArea(remembered, storage);
    rememberMapChosenAreaSelection(
      {
        cityId: "london",
        kind: "night-area",
        label: "Camden",
        slug: "camden",
        center: [-0.143, 51.539],
      },
      storage,
    );

    expect(readMapChosenArea(storage)).toEqual({
      cityId: "london",
      label: "Camden",
      slug: "camden",
      center: [-0.143, 51.539],
      kind: "night-area",
    });
  });

  it("stores a searched locality as a locality, not a Night Area", () => {
    const storage = makeMemoryStorage();
    rememberMapChosenAreaSelection(
      {
        cityId: "london",
        kind: "locality",
        label: "Willesden",
        slug: "locality:willesden",
        center: [-0.23, 51.55],
      },
      storage,
    );

    expect(JSON.parse(storage.getItem(MAP_CHOSEN_AREA_KEY) ?? "null")).toEqual({
      cityId: "london",
      label: "Willesden",
      slug: "locality:willesden",
      kind: "locality",
      center: [-0.23, 51.55],
    });
  });

  it("stores a searched borough as a borough, not a Night Area", () => {
    const storage = makeMemoryStorage();
    rememberMapChosenAreaSelection(
      {
        cityId: "london",
        kind: "borough",
        label: "Hackney",
        slug: "borough:hackney",
        center: [-0.06, 51.545],
      },
      storage,
    );

    expect(JSON.parse(storage.getItem(MAP_CHOSEN_AREA_KEY) ?? "null")).toEqual({
      cityId: "london",
      label: "Hackney",
      slug: "borough:hackney",
      kind: "borough",
      center: [-0.06, 51.545],
    });
  });

  it("round-trips a remembered area", () => {
    const storage = makeMemoryStorage();
    expect(readMapChosenArea(storage)).toBeNull();
    writeMapChosenArea(
      {
        cityId: "london",
        label: "Camden",
        slug: "camden",
        center: [-0.143, 51.539],
        kind: "night-area",
      },
      storage,
    );
    expect(readMapChosenArea(storage)).toEqual({
      cityId: "london",
      label: "Camden",
      slug: "camden",
      center: [-0.143, 51.539],
      kind: "night-area",
    });
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).toContain("Camden");
    clearMapChosenArea(storage);
    expect(readMapChosenArea(storage)).toBeNull();
  });

  it("refuses malformed stored rows", () => {
    const storage = makeMemoryStorage();
    storage.setItem(MAP_CHOSEN_AREA_KEY, JSON.stringify({ label: "Camden" }));
    expect(readMapChosenArea(storage)).toBeNull();
  });

  it.each([
    ["non-finite longitude", "1e400", "51.5"],
    ["longitude above 180", "180.01", "51.5"],
    ["longitude below -180", "-180.01", "51.5"],
    ["latitude above 90", "-0.1", "90.01"],
    ["latitude below -90", "-0.1", "-90.01"],
  ])("removes a stored row with %s", (_case, longitude, latitude) => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      `{"cityId":"london","label":"Bad","slug":"bad","kind":"locality","center":[${longitude},${latitude}]}`,
    );

    expect(readMapChosenArea(storage)).toBeNull();
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).toBeNull();
  });

  it("returns a stable snapshot for useSyncExternalStore", () => {
    const storage = makeMemoryStorage();
    writeMapChosenArea(
      {
        cityId: "london",
        label: "Camden",
        slug: "camden",
        center: [-0.143, 51.539],
        kind: "night-area",
      },
      storage,
    );
    const first = readMapChosenArea(storage);
    const second = readMapChosenArea(storage);
    expect(first).toBe(second);
  });
});

describe("remembered named-place camera", () => {
  it("classifies Choose Area locality rows before they reach storage", () => {
    expect(mapChosenAreaPickerKind("locality:willesden")).toBe("locality");
    expect(mapChosenAreaPickerKind("camden")).toBe("night-area");
  });

  it("restores a locality with the same zoom used by search selection", () => {
    expect(
      mapChosenAreaFlyTarget(
        {
          cityId: "london",
          label: "Willesden",
          slug: "locality:willesden",
          kind: "locality",
          center: [-0.23, 51.55],
        },
        LOCALITY_FLY_ZOOM,
      ),
    ).toEqual({ kind: "locality", zoom: LOCALITY_FLY_ZOOM });
  });

  it("keeps Night Areas and boroughs on their default camera zoom", () => {
    expect(
      mapChosenAreaFlyTarget(
        {
          cityId: "london",
          label: "Camden",
          slug: "camden",
          kind: "night-area",
          center: [-0.143, 51.539],
        },
        LOCALITY_FLY_ZOOM,
      ),
    ).toEqual({ kind: "area", zoom: undefined });
    expect(
      mapChosenAreaFlyTarget(
        {
          cityId: "london",
          label: "Hackney",
          slug: "borough:hackney",
          kind: "borough",
          center: [-0.06, 51.545],
        },
        LOCALITY_FLY_ZOOM,
      ),
    ).toEqual({ kind: "borough", zoom: undefined });
  });
});

const CAMDEN: MapChosenArea = {
  cityId: "london",
  label: "Camden",
  slug: "camden",
  center: [-0.143, 51.539],
  kind: "night-area",
};

const NEAR_ME: MapChosenArea = {
  cityId: "london",
  label: "Near me",
  slug: "near-me",
  kind: "near-me",
};

describe("resolveMapChosenAreaRestore", () => {
  const base = {
    stored: CAMDEN,
    cityId: "london" as const,
    explicitArrivalIntent: false,
    hasRestoredViewport: false,
    venueCount: 40,
  };

  it("restores the remembered area on a clean arrival", () => {
    expect(resolveMapChosenAreaRestore(base)).toEqual({
      action: "restore",
      area: CAMDEN,
    });
  });

  it("restores a typed locality without relabelling it as a Night Area", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({
        cityId: "london",
        label: "Willesden",
        slug: "locality:willesden",
        center: [-0.23, 51.55],
        kind: "locality",
      }),
    );
    const stored = readMapChosenArea(storage);

    expect(
      resolveMapChosenAreaRestore({ ...base, stored }),
    ).toEqual({
      action: "restore",
      area: {
        cityId: "london",
        label: "Willesden",
        slug: "locality:willesden",
        center: [-0.23, 51.55],
        kind: "locality",
      },
    });
  });

  it("restores a typed borough without relabelling it as a Night Area", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({
        cityId: "london",
        label: "Hackney",
        slug: "borough:hackney",
        center: [-0.06, 51.545],
        kind: "borough",
      }),
    );
    const stored = readMapChosenArea(storage);

    expect(
      resolveMapChosenAreaRestore({ ...base, stored }),
    ).toEqual({
      action: "restore",
      area: {
        cityId: "london",
        label: "Hackney",
        slug: "borough:hackney",
        center: [-0.06, 51.545],
        kind: "borough",
      },
    });
  });

  it("stands down for an explicit arrival, so a shared ?sel= keeps its camera", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, explicitArrivalIntent: true }),
    ).toEqual({ action: "skip" });
  });

  it("stands down for a restored session viewport", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, hasRestoredViewport: true }),
    ).toEqual({ action: "skip" });
  });

  it("skips a row belonging to another city", () => {
    expect(
      resolveMapChosenAreaRestore({
        ...base,
        stored: { ...CAMDEN, cityId: "manchester" },
      }),
    ).toEqual({ action: "skip" });
  });

  it("skips when nothing is remembered", () => {
    expect(resolveMapChosenAreaRestore({ ...base, stored: null })).toEqual({
      action: "skip",
    });
  });

  it("re-runs the live locate flow for a remembered Near me, never a stored fix", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, stored: NEAR_ME, venueCount: 12 }),
    ).toEqual({ action: "locate" });
  });

  it("waits for the index before a remembered Near me, and never on intent", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, stored: NEAR_ME, venueCount: 0 }),
    ).toEqual({ action: "wait" });
    // Intent is answered first: an explicit arrival never leaves the one-shot
    // hanging on a venue count that may never arrive.
    expect(
      resolveMapChosenAreaRestore({
        ...base,
        stored: NEAR_ME,
        venueCount: 0,
        explicitArrivalIntent: true,
      }),
    ).toEqual({ action: "skip" });
  });
});

describe("the remembered map area holds no viewer point", () => {
  it("writes a Near me row as a mode marker with no coordinates", () => {
    const storage = makeMemoryStorage();
    writeMapChosenArea(NEAR_ME, storage);
    const stored: unknown = JSON.parse(
      storage.getItem(MAP_CHOSEN_AREA_KEY) ?? "null",
    );
    expect(stored).toEqual({
      cityId: "london",
      label: "Near me",
      slug: "near-me",
      kind: "near-me",
    });
    expect(Object.keys(stored as object)).not.toContain("center");
  });

  it("still writes a named area's own published centre", () => {
    const storage = makeMemoryStorage();
    writeMapChosenArea(CAMDEN, storage);
    expect(
      JSON.parse(storage.getItem(MAP_CHOSEN_AREA_KEY) ?? "null"),
    ).toMatchObject({ kind: "night-area", center: [-0.143, 51.539] });
  });

  it("erases a legacy Near me row's coordinates from storage on the first read", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({
        cityId: "london",
        label: "Near me",
        slug: "near-me",
        kind: "near-me",
        center: [-0.09, 51.515],
      }),
    );
    readMapChosenArea(storage);
    // Not merely projected away on the way out: gone from the device, because
    // the write that would have overwritten it may never come.
    const settled: unknown = JSON.parse(
      storage.getItem(MAP_CHOSEN_AREA_KEY) ?? "null",
    );
    expect(settled).toEqual({
      cityId: "london",
      label: "Near me",
      slug: "near-me",
      kind: "near-me",
    });
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).not.toContain("51.515");
  });

  it("drops a row nothing can parse rather than leaving it on the device", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({ shape: "unknown", center: [-0.09, 51.515] }),
    );
    expect(readMapChosenArea(storage)).toBeNull();
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).toBeNull();
  });

  it("keeps a named area's centre, and rewrites nothing once it is canonical", () => {
    const storage = makeMemoryStorage();
    writeMapChosenArea(CAMDEN, storage);
    const written = storage.getItem(MAP_CHOSEN_AREA_KEY);
    expect(readMapChosenArea(storage)).toEqual(CAMDEN);
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).toBe(written);
  });

  it("survives a storage that refuses the cleanup write", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({
        cityId: "london",
        label: "Near me",
        slug: "near-me",
        kind: "near-me",
        center: [-0.09, 51.515],
      }),
    );
    const refusing: Storage = {
      ...storage,
      getItem: (key: string) => storage.getItem(key),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    const read = readMapChosenArea(refusing);
    expect(read).toEqual({
      cityId: "london",
      label: "Near me",
      slug: "near-me",
      kind: "near-me",
    });
    expect(read && "center" in read).toBe(false);
  });

  it("never hands a legacy Near me row's coordinates to a reader", () => {
    const storage = makeMemoryStorage();
    // Exactly what the previous build wrote: a viewer fix beside the marker.
    storage.setItem(
      MAP_CHOSEN_AREA_KEY,
      JSON.stringify({
        cityId: "london",
        label: "Near me",
        slug: "near-me",
        kind: "near-me",
        center: [-0.09, 51.515],
      }),
    );
    const read = readMapChosenArea(storage);
    expect(read).toEqual({
      cityId: "london",
      label: "Near me",
      slug: "near-me",
      kind: "near-me",
    });
    expect(read && "center" in read).toBe(false);
    // And the restore lane can only ask for a fresh fix, never replay that one.
    expect(
      resolveMapChosenAreaRestore({
        stored: read,
        cityId: "london",
        explicitArrivalIntent: false,
        hasRestoredViewport: false,
        venueCount: 12,
      }),
    ).toEqual({ action: "locate" });
  });
});
