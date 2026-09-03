import { describe, expect, it, vi } from "vitest";

import {
  readOpeningMapLocation,
  readMapOpeningLocation,
  resolveMapOpeningLocation,
  resolveMapOpeningView,
  writeMapOpeningLocation,
} from "@/lib/mapOpeningLocation";
import { CITIES } from "@/lib/cities";

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

describe("map opening location", () => {
  it("uses city zoom until a reader location owns the opening view", () => {
    const cityView = CITIES.london.mapView;

    expect(resolveMapOpeningView(cityView, null, 15)).toEqual(cityView);
    expect(resolveMapOpeningView(cityView, null, 15).zoom).toBe(12);
    expect(
      resolveMapOpeningView(
        cityView,
        { lat: 51.51, lng: -0.09 },
        15,
      ),
    ).toEqual({
      ...cityView,
      center: [-0.09, 51.51],
      zoom: 15,
    });
  });

  it("uses last-known location before the city default", () => {
    expect(resolveMapOpeningLocation(
      { lat: 51.51, lng: -0.09 },
      { lat: 51.52, lng: -0.12 },
    )).toEqual({ lat: 51.51, lng: -0.09 });
    expect(resolveMapOpeningLocation(null, { lat: 51.52, lng: -0.12 }))
      .toEqual({ lat: 51.52, lng: -0.12 });
  });

  it("rejects malformed storage and writes valid coordinates", () => {
    const store = storage();
    store.setItem("pubmax:map-opening-location:v1", "{bad");
    expect(readMapOpeningLocation(store)).toBeNull();

    writeMapOpeningLocation({ lat: 51.5, lng: -0.1 }, store);
    expect(readMapOpeningLocation(store)).toEqual({ lat: 51.5, lng: -0.1 });

    store.setItem("pubmax:map-opening-location:v1", JSON.stringify({ lat: 99, lng: 0 }));
    expect(readMapOpeningLocation(store)).toBeNull();
  });

  it("reads current coordinates when permission is granted", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => ({ state: "granted" } as PermissionStatus)),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("returns immediately after showing an ungranted permission prompt", async () => {
    const getCurrentPosition = vi.fn();
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const onPermissionPrompt = vi.fn();
    const location = await readOpeningMapLocation(
      {
        permissions: {
          query: vi.fn(async () => ({ state: "prompt" } as PermissionStatus)),
        },
        geolocation: { getCurrentPosition },
      },
      { onPermissionPrompt },
    );

    expect(location).toBeNull();
    expect(onPermissionPrompt).toHaveBeenCalledOnce();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("requests coordinates when Permissions API is unavailable", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const onPermissionPrompt = vi.fn();
    const location = await readOpeningMapLocation(
      { geolocation: { getCurrentPosition } },
      { onPermissionPrompt },
    );

    expect(location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(onPermissionPrompt).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("does not request coordinates after permission is denied", async () => {
    const getCurrentPosition = vi.fn();
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => ({ state: "denied" } as PermissionStatus)),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("tries coordinates when the permission query fails", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => { throw new Error("unsupported"); }),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("tries coordinates when the permission result is malformed", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => null as unknown as PermissionStatus),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("falls back when geolocation throws or returns malformed coordinates", async () => {
    const throwing = await readOpeningMapLocation({
      geolocation: {
        getCurrentPosition: vi.fn(() => { throw new Error("unsupported"); }),
      },
    });
    expect(throwing).toBeNull();

    const malformed = await readOpeningMapLocation({
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          success({ coords: null } as unknown as GeolocationPosition);
        }),
      },
    });
    expect(malformed).toBeNull();
  });
});
