# Map speed phase 2 evidence

## Payload

Measured from the production build data files:

| Payload | Bytes | Use |
| --- | ---: | --- |
| Legacy `venues_slim.json` | 933,007 | Full index baseline |
| Spatial manifest | 43,281 | Opening lookup |
| `51.500_-0.125` cell | 44,378 | Central London viewport |
| `51.525_-0.125` cell | 22,314 | Central London viewport |
| Initial viewport rows | 109,973 | Manifest plus two cells |

The initial viewport payload is 8.5x smaller than the legacy index. In this
28 August capture, the ring loaded after the initial shard settled and followed
the current map bounds. The current scheduler keeps the viewport load on the
caller's turn and sends the neighbouring ring to idle; `perf/route-budgets.json`
owns the current request-count note.

## Browser probe

Probe: production build, Chromium, 390x844, CPU 4x, 1.6 Mbps download,
750 Kbps upload, 150 ms latency, one cold visit followed by a reload after the
resume snapshot was written. Data bytes use `PerformanceResourceTiming` decoded
body sizes. Cache-served entries report zero transfer bytes.

| Visit | First-pins mark | Wall to painted pins | First-paint data | Resume mirror |
| --- | ---: | ---: | ---: | ---: |
| Cold | 5,058 ms | 5,496 ms | 109,793 bytes | 0 bytes |
| Warm | 2,554 ms | 3,756 ms | 109,793 bytes, 0 transfer | 247,359 bytes |

The repository's exact pin-SLA test also passed on the rebuilt production
server: `e2e/mobile-map-chrome-fit.spec.ts` reported 3.3 s with its 4 s
enforcement ceiling. The stricter network-shaped cold probe measured 5,058 ms,
so it misses the 4,000 ms cold target and remains diagnostic evidence rather
than release-gate evidence.

## Post-fix diagnostic

The current production build was also checked in one same-session Chromium run
at 390x844 with SwiftShader and no network shaping. Cold pin-ready was 11,574
ms and the following reload was 2,940 ms. These local figures are diagnostic
only and do not replace the network-shaped SLA evidence above.

## Coverage

- `public/sw.js` uses versioned stale-while-revalidate caches for map data,
  OpenFreeMap tiles, and hashed static assets, with separate bounded data and
  tile caps. Price updates remain network-first.
- `public/map-first-paint-init.js` warms the manifest and opening cells only,
  using the last known location when it is valid for London, and starts only
  after first pins on a first visit.
- First visits load the compatibility core before any spatial manifest work.
  The first-pins marker enables spatial warmup and service-worker registration
  for later visits.
- `lib/mapResume.ts` mirrors the parsed IndexedDB snapshot into localStorage so
  the map can seed pins and camera synchronously, then reconcile with IndexedDB
  and fresh shards.
- `scripts/validate-data.mjs` validates the spatial manifest, cell coverage,
  byte budgets, and generated rows.

## Follow-up validation

Protocol: production builds, 390x844 mobile viewport, device scale factor 3,
three paired runs. Each pair used one Chromium process with separate clean
contexts for main and follow-up, `--disable-gpu`, and one cold visit followed
by one same-session reload. Result uses the `pubmax:first-pins` mark.

| Visit | Main median | Follow-up median |
| --- | ---: | ---: |
| Cold | 884 ms | 856 ms |
| Warm | - | 302 ms |

Follow-up cold is 3.2% faster than main and passes the 10% limit. Follow-up
warm is 35.3% of follow-up cold and passes the 60% limit.

## Validation

- `npm run validate-data` passed.
- Targeted Vitest files passed: 35 tests, then 26 tests.
- `npm run typecheck` passed with 4 GB Node heap.
- `npm run lint -- --quiet` passed.
- Production `next build` passed with 2 GB Node heap and 520 static pages.
- Exact map pin-SLA Playwright test passed at 3.3 s with its 4 s ceiling.

GitHub Actions is environment-blocked by repository billing state, so local
verification is the release bar for this lane.
