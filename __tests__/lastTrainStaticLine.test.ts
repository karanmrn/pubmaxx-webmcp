import { describe, expect, it } from "vitest";
import { staticStationLine } from "@/components/map/LastTrainCard";

// Friction-sweep follow-up 7: the Last Pint card's total-failure state hands
// over the nearest bundled station as static value instead of only apologising.
// Pure function, fixed coordinates — no clocks, no network.

describe("staticStationLine", () => {
  it("names the nearest bundled station with a walk estimate in central London", () => {
    // Ye Olde Cheshire Cheese, Fleet Street — comfortably inside the bundled set.
    const line = staticStationLine("london", 51.5142, -0.1073);
    expect(line).toMatch(/^Nearest station on our map: /);
    expect(line).toMatch(/about \d+ min on foot\.$/);
  });

  it("caps the listed lines at three", () => {
    // Next to King's Cross St Pancras (five lines in the bundle).
    const line = staticStationLine("london", 51.53, -0.124);
    expect(line).toContain("King's Cross St Pancras");
    const listed = line?.match(/\(([^)]+)\)/)?.[1] ?? "";
    expect(listed.split(",").length).toBeLessThanOrEqual(3);
  });

  it("returns null when the nearest bundled station is beyond a real walk", () => {
    // Upminster: zone-6 east edge, nowhere near the central bundle.
    expect(staticStationLine("london", 51.5557, 0.2512)).toBeNull();
  });

  it("returns null outside London (the bundle is London-only)", () => {
    expect(staticStationLine("manchester", 53.4808, -2.2426)).toBeNull();
  });

  it("returns null on non-finite coordinates", () => {
    expect(staticStationLine("london", Number.NaN, -0.12)).toBeNull();
  });
});
