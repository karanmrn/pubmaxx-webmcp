import { describe, expect, it } from "vitest";

import {
  filterNightShapingSignals,
  isAviationNoiseSignal,
  type CityStatusSignal,
} from "@/lib/citymcp/client";

const signal = (headline: string, detail?: string): CityStatusSignal => ({
  headline,
  ...(detail ? { detail } : {}),
});

describe("isAviationNoiseSignal", () => {
  it("drops the EasyJet Gatwick airline story (the owner's reported noise)", () => {
    expect(
      isAviationNoiseSignal(signal("EasyJet cancels flights at Gatwick", "Passengers stranded after crew shortage")),
    ).toBe(true);
  });

  it("drops assorted flight-side aviation items", () => {
    expect(isAviationNoiseSignal(signal("Ryanair strike hits departures"))).toBe(true);
    expect(isAviationNoiseSignal(signal("Heathrow baggage system down"))).toBe(true);
    expect(isAviationNoiseSignal(signal("British Airways cabin crew walkout"))).toBe(true);
    expect(isAviationNoiseSignal(signal("Runway closure at Stansted"))).toBe(true);
  });

  it("keeps genuine night-shaping ground transport, incl. rail links to airports", () => {
    expect(isAviationNoiseSignal(signal("Victoria line part closure", "No service Brixton to Warren Street"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Gatwick Express suspended", "Rail engineering works overnight"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Heathrow: Piccadilly line trains not stopping", "Use the Elizabeth line instead"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Night bus N29 diversion", "Roadworks near Wood Green"))).toBe(false);
  });

  it("keeps non-transport signals (events, weather, safety) — filter is aviation-only", () => {
    expect(isAviationNoiseSignal(signal("Thunderstorm warning tonight"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Soho street festival until late"))).toBe(false);
    expect(isAviationNoiseSignal(signal(""))).toBe(false);
  });
});

describe("filterNightShapingSignals", () => {
  it("removes only aviation noise, preserving order of the rest", () => {
    const input: CityStatusSignal[] = [
      signal("Victoria line minor delays"),
      signal("EasyJet cancels flights at Gatwick"),
      signal("Soho street festival until late"),
      signal("Ryanair check-in desk queues"),
      signal("Gatwick Express suspended", "rail works"),
    ];
    const out = filterNightShapingSignals(input);
    expect(out.map((s) => s.headline)).toEqual([
      "Victoria line minor delays",
      "Soho street festival until late",
      "Gatwick Express suspended",
    ]);
  });

  it("is pure: does not mutate its input and tolerates undefined", () => {
    const input: CityStatusSignal[] = [signal("Flights grounded")];
    const snapshot = [...input];
    filterNightShapingSignals(input);
    expect(input).toEqual(snapshot);
    expect(filterNightShapingSignals(undefined)).toEqual([]);
  });
});
