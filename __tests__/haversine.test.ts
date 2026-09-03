import { describe, it, expect } from "vitest";

import { haversineKm } from "@/lib/haversine";

// The single shared great-circle helper. All map "nearest" features depend on it,
// so pin its behaviour: zero for a point on itself, symmetric, ~111 km per degree
// of latitude, and a real London distance in a sane range.
describe("haversineKm", () => {
  it("is ~0 km for identical points", () => {
    expect(haversineKm([-0.1, 51.5], [-0.1, 51.5])).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const a: [number, number] = [-0.12, 51.5];
    const b: [number, number] = [-0.08, 51.52];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("is ~111 km for one degree of latitude", () => {
    const d = haversineKm([0, 51], [0, 52]);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("gives a sane King's Cross → Waterloo distance (~3 km)", () => {
    const kingsCross: [number, number] = [-0.124, 51.5308];
    const waterloo: [number, number] = [-0.1133, 51.5033];
    const d = haversineKm(kingsCross, waterloo);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(3.6);
  });
});
