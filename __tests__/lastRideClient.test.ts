import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetLastRideClientCache,
  loadLastRide,
  loadStableLastRide,
  prefetchLastRide,
} from "@/lib/lastRideClient";

beforeEach(() => {
  __resetLastRideClientCache();
  vi.restoreAllMocks();
});

describe("last-ride client cache", () => {
  it("keeps sheet-open prefetches off the live endpoint", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () =>
        new Response(JSON.stringify({ station: { name: "Westminster" }, trains: [] }), {
          status: 200,
        }),
      );

    prefetchLastRide("london", 51.5, -0.12);
    const stableRead = loadStableLastRide("london", 51.5, -0.12);
    const cardRead = loadLastRide("london", 51.5, -0.12);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("scope=stable");
    expect(String(fetchSpy.mock.calls[1][0])).not.toContain("scope=stable");
    await expect(stableRead).resolves.toEqual(
      expect.objectContaining({ station: { name: "Westminster" } }),
    );
    await expect(cardRead).resolves.toEqual(
      expect.objectContaining({ station: { name: "Westminster" } }),
    );
  });

  it("cannot promote prefetched timetable departures to live", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          station: { name: "Westminster" },
          trains: [],
          departures: [
            {
              lineId: "district",
              lineName: "District",
              colour: "#00782a",
              times: ["23:41"],
              live: true,
            },
          ],
          decision: { decision: "order_one_more" },
        }),
        { status: 200 },
      ),
    );

    const result = await loadStableLastRide("london", 51.5, -0.12);

    expect(result?.departures?.[0].live).toBe(false);
    expect(result?.decision).toBeUndefined();
  });

  it("drops a failed request so a later card read can retry", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ station: { name: "Temple" }, trains: [] }), {
          status: 200,
        }),
      );

    await expect(loadLastRide("london", 51.51, -0.11)).rejects.toThrow("offline");
    await expect(loadLastRide("london", 51.51, -0.11)).resolves.toEqual(
      expect.objectContaining({ station: { name: "Temple" } }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
