import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  POI_TOGGLE_GROUPS,
  defaultPoiHidden,
  defaultPoiHiddenMobile,
  isPoiGroupOn,
  isTransitNetworkVisible,
  parsePoiHidden,
  poiGroupToggleChange,
  togglePoiGroup,
  type PoiHidden,
  type PoiHiddenChange,
} from "@/lib/poiToggleGroups";

describe("poiToggleGroups", () => {
  it("exposes Tube and Rail as separate Layers chips", () => {
    const tube = POI_TOGGLE_GROUPS.find((group) => group.id === "tube");
    const rail = POI_TOGGLE_GROUPS.find((group) => group.id === "rail");
    expect(tube?.categories).toEqual(["tube"]);
    expect(tube?.label).toBe("Tube");
    expect(rail?.categories).toEqual(["rail"]);
    expect(rail?.label).toBe("Rail");
  });

  it("defaults Tube, Rail, Parks, and Sights on for desktop", () => {
    const hidden = defaultPoiHidden();
    expect(hidden.tube).toBe(false);
    expect(hidden.rail).toBe(false);
    expect(hidden.park).toBe(false);
    expect(hidden.sight).toBe(false);
    expect(hidden.bus).toBe(true);
    expect(hidden.historic).toBe(true);
  });

  it("hides every POI layer on mobile by default", () => {
    const hidden = defaultPoiHiddenMobile();
    for (const value of Object.values(hidden)) {
      expect(value).toBe(true);
    }
  });

  it("toggles Tube independently of Rail; lines follow Tube only", () => {
    const hidden = defaultPoiHidden();
    const tube = POI_TOGGLE_GROUPS.find((group) => group.id === "tube")!;
    expect(isPoiGroupOn(hidden, tube)).toBe(true);
    expect(isTransitNetworkVisible(hidden)).toBe(true);
    const off = togglePoiGroup(hidden, tube);
    expect(off.tube).toBe(true);
    expect(off.rail).toBe(false);
    expect(isTransitNetworkVisible(off)).toBe(false);
    const railOff = togglePoiGroup(hidden, POI_TOGGLE_GROUPS.find((g) => g.id === "rail")!);
    expect(railOff.rail).toBe(true);
    expect(railOff.tube).toBe(false);
    expect(isTransitNetworkVisible(railOff)).toBe(true);
  });

  it("keeps every earlier toggle when taps land before the owner re-renders", () => {
    // The chip dispatch is an UPDATER over the owner's current state. Apply the
    // owner's setState semantics with three taps sharing one stale render:
    // every tapped layer must end up on, not only the last one.
    let ownerState: PoiHidden = defaultPoiHiddenMobile();
    const dispatch = (change: PoiHiddenChange) => {
      ownerState = typeof change === "function" ? change(ownerState) : change;
    };
    const group = (id: string) => POI_TOGGLE_GROUPS.find((g) => g.id === id)!;
    for (const id of ["tube", "rail", "park"]) {
      dispatch(poiGroupToggleChange(group(id)));
    }
    expect(ownerState.tube).toBe(false);
    expect(ownerState.rail).toBe(false);
    expect(ownerState.park).toBe(false);
    expect(ownerState.bus).toBe(true);
    // A second Tube tap through the same route turns only Tube back off.
    dispatch(poiGroupToggleChange(group("tube")));
    expect(ownerState.tube).toBe(true);
    expect(ownerState.rail).toBe(false);
  });

  it("the Layers control dispatches the updater form, never its own snapshot", () => {
    // The race is only fixed while the CONTROL sends poiGroupToggleChange. A
    // return to togglePoiGroup(poiHidden, …) reintroduces the lost updates.
    const source = readFileSync(
      join(process.cwd(), "components/map/MapLayersControl.tsx"),
      "utf8",
    );
    expect(source).toContain("onPoiHiddenChange(poiGroupToggleChange(group))");
    expect(source).not.toMatch(/togglePoiGroup\(\s*poiHidden/);
  });

  it("restores only an exact stored layer map", () => {
    const stored = { ...defaultPoiHidden(), bus: false };
    expect(parsePoiHidden(stored)).toEqual(stored);
    expect(parsePoiHidden(stored)).not.toBe(stored);
    expect(parsePoiHidden(null)).toBeNull();
    expect(parsePoiHidden(undefined)).toBeNull();
    expect(parsePoiHidden([])).toBeNull();
    expect(parsePoiHidden({ tube: true })).toBeNull();
    expect(parsePoiHidden({ ...defaultPoiHidden(), tube: 1 })).toBeNull();
    expect(parsePoiHidden({ ...defaultPoiHidden(), stray: true })).toBeNull();
  });
});
