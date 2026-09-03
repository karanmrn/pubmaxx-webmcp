# Mobile V1 performance baseline — prod

- Target: `https://pubmaxxing.com`
- Generated: 2026-07-24T13:08:31.300Z
- Method: Lighthouse mobile, 4x CPU, simulated Slow-4G (rtt 150ms / 1638.4kbps). Medians of 3 runs/route.

## Lighthouse core routes (median)

| Route | LCP | TBT | CLS | TTI | FCP | Perf | runs |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/` | 1824 ms | 274 ms | 0.004 | 5162 ms | 1224 ms | 91 | 3/3 |
| `/map` | 6814 ms | 458 ms | 0.000 | 6814 ms | 1339 ms | 62 | 2/3 |
| `/today` | 1822 ms | 513 ms | 0.000 | 3788 ms | 1204 ms | 86 | 3/3 |
| `/tonight` | 1739 ms | 96 ms | 0.007 | 3572 ms | 1139 ms | 99 | 3/3 |
| `/plan` | 2353 ms | 142 ms | 0.000 | 3437 ms | 1152 ms | 97 | 3/3 |

## Tab transitions from /today (median of 5 runs, budget 300ms)

| Tap | Target | Median | Budget | Within? |
|---|---|---:|---:|:---:|
| Map | `/map` | 691 ms | 300 ms | ❌ |
| Tonight | `/tonight` | 596 ms | 300 ms | ❌ |
| Stories | `/feed` | 686 ms | 300 ms | ❌ |
| You | `/u` | 559 ms | 300 ms | ❌ |

_Every fix lane attaches its before/after delta measured by `scripts/perf-baseline.mjs`._
