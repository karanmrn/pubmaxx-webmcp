import { describe, expect, it } from "vitest";

import { deriveOgPriceWaveLayers } from "@/lib/ogPriceWaves";

describe("deriveOgPriceWaveLayers", () => {
  it("turns each observed price-band share into fixed, reproducible wave geometry", () => {
    expect(
      deriveOgPriceWaveLayers([2, 1, 1], { width: 1200, height: 630 }),
    ).toEqual([
      {
        band: 0,
        count: 2,
        share: 0.5,
        path: "M 0 239 C 216 144 408 334 606 239 S 936 158 1200 258 L 1200 630 L 0 630 Z",
      },
      {
        band: 1,
        count: 1,
        share: 0.25,
        path: "M 0 353 C 192 287 456 419 639 353 S 960 297 1200 366 L 1200 630 L 0 630 Z",
      },
      {
        band: 2,
        count: 1,
        share: 0.25,
        path: "M 0 466 C 192 400 504 532 657 466 S 984 410 1200 479 L 1200 630 L 0 630 Z",
      },
    ]);
  });

  it("omits bands with no observations instead of inventing decorative layers", () => {
    expect(
      deriveOgPriceWaveLayers([0, 4, 0], { width: 1200, height: 630 }),
    ).toEqual([
      {
        band: 1,
        count: 4,
        share: 1,
        path: "M 0 353 C 264 202 456 504 594 353 S 960 225 1200 383 L 1200 630 L 0 630 Z",
      },
    ]);
    expect(
      deriveOgPriceWaveLayers([0, 0, 0], { width: 1200, height: 630 }),
    ).toEqual([]);
  });

  it("changes geometry when the underlying distribution changes", () => {
    const cheapHeavy = deriveOgPriceWaveLayers([6, 3, 1], {
      width: 1200,
      height: 630,
    });
    const dearHeavy = deriveOgPriceWaveLayers([1, 3, 6], {
      width: 1200,
      height: 630,
    });

    expect(cheapHeavy[0]?.path).not.toBe(dearHeavy[0]?.path);
    expect(cheapHeavy[2]?.path).not.toBe(dearHeavy[2]?.path);
    expect(cheapHeavy.map(({ count, share }) => ({ count, share }))).toEqual([
      { count: 6, share: 0.6 },
      { count: 3, share: 0.3 },
      { count: 1, share: 0.1 },
    ]);
  });
});
