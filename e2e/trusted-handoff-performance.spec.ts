import { expect, test } from "@playwright/test";

import { samplePagePerformance } from "./gateEvidence";

// §11 performance sampling for the trusted-handoff journey surfaces, built on the
// L01 perf helper (fresh page per sample, buffered LCP/CLS observers, useful-
// state timing to a selector). PUBMAX_PERF_SAMPLES controls the sample count
// (§11 runs it at 5); default 3 keeps a bare `playwright test` honest but quick.
//
// Right-sized: this gate proves the handoff endpoints stay layout-stable and
// render promptly on the production build. /map's WebGL render has its own perf
// coverage (map-gl / gate-z); this spec gates the lighter acceptance + composer
// surfaces the handoff funnels through. Medians dampen cold-render variance;
// CLS is the strict, stable budget, LCP a generous regression ceiling.

const SAMPLES = Math.max(1, Math.trunc(Number(process.env.PUBMAX_PERF_SAMPLES ?? 3)) || 3);

const SURFACES = [
  { path: "/near", label: "Near acceptance" },
  { path: "/plan", label: "Plan composer" },
] as const;

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

for (const surface of SURFACES) {
  test(`${surface.label} (${surface.path}) stays inside the CLS + LCP budget`, async ({ context }) => {
    const samples = await samplePagePerformance({
      context,
      url: surface.path,
      samples: SAMPLES,
      usefulSelector: "main",
    });
    expect(samples).toHaveLength(SAMPLES);

    const clsMedian = median(samples.map((s) => s.cls));
    const lcpMedian = median(samples.map((s) => s.lcp));
    const usefulMedian = median(samples.map((s) => s.usefulState ?? Number.POSITIVE_INFINITY));

    // Layout stability is the strict, stable budget.
    expect(clsMedian, `${surface.path} median CLS`).toBeLessThan(0.1);
    // Generous LCP ceiling on the local production build: catches gross
    // regressions without flaking on cold first-render variance.
    expect(lcpMedian, `${surface.path} median LCP (ms)`).toBeLessThan(4_000);
    // Main content is reachable promptly.
    expect(usefulMedian, `${surface.path} median useful-state (ms)`).toBeLessThan(4_000);
  });
}
