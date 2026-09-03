# Deep Review — DATA / PIPELINE corpus (2026-07-18)

Adversarial deep-review of the five data/pipeline PRs: **#308** (coverage report),
**#315** (OSM +657 venues), **#317** (slim sharding, stacked on #315), **#319**
(borough label repair), **#320** (price harvest, stacked on #315). Reviewer:
`review/deep-data` (from `main`). Every claim below was re-run, not trusted.

## Method / what was actually executed

- `git fetch origin`; diffed each PR (`gh pr diff`).
- **Sequential merge simulation** (`git merge-tree`) to find cross-PR conflicts that
  the isolation-only checks in `docs/MERGE_ORDER_2026-07-18.md` (#316) miss.
- **Ran the real scripts** in throwaway worktrees (no `node_modules` needed — the
  data scripts import only `node:` builtins + local `scripts/lib/*`):
  - `repair_borough_labels.mjs --dry` / apply on the **post-#315** dataset.
  - `build_slim_index.mjs` baseline (#317) and after layering #319 + #320.
  - `validate-data.mjs` on the fully-stacked (#315+#320+#319+#317) state.
  - `report_borough_coverage.mjs` twice (idempotency) + secret grep of scripts/logs.

## Bottom line

All five are **fundamentally sound and mechanically honest** — every headline number
reproduced. The risk is **entirely in merge ordering**: `#319` branched from `main`
and collides with the `#315` data artifacts, and `#317`'s shard files are pure
derived artifacts that go stale the moment `#319`/`#320` touch the dataset. The
existing merge-order doc (#316) predates #317/#319/#320 and gives **no** guidance.

---

## Findings — severity-ranked

### HIGH-1 — #319 hard-conflicts with #315 (and #320); naive resolution deletes 660 venues
`public/data/pint_prices_app_dataset.json` and `public/data/venues_slim.json` are
**single-line JSON** (0 newlines). #315 (adds 660 OSM rows), #320 (adds 2 prices),
and #319 (relabels 610 rows) each **rewrite the whole line**, so git 3-way merge
conflicts on both files:

```
#319 onto (main+#315):        CONFLICT pint_prices_app_dataset.json + venues_slim.json
#319 onto (main+#315+#320):   CONFLICT pint_prices_app_dataset.json + venues_slim.json
```

#319 branched from `main`, so its committed artifacts **do not contain** the 660 OSM
rows or the 2 harvested prices. A "take #319's side" resolution silently **drops all
of #315 and #320**. Fix: rebase #319 onto post-#315(+#320) and **re-run
`repair_borough_labels.mjs` + `build:slim`** (both proven re-runnable below); commit
the regenerated artifacts. This must be spelled out for Sol — it is not obvious from
the conflict alone.

### HIGH-2 — merge-order doc (#316) is stale for this corpus
`docs/MERGE_ORDER_2026-07-18.md` lists only **#308** (step 2) and **#315** (step 3);
**#317, #319, #320 do not appear** (created after it). It therefore contains no
conflict-chain guidance for the data artifacts. Amendment required (see below).

### MED-3 — #317's committed shard files go stale after #319/#320 → "after #315" is not enough
#317 leaves the monolith `venues_slim.json` untouched and adds `venues_slim.core.json`
+ 10 per-borough shard files, **built from #315-only labels/prices**. `validate-data`
(lines 501-505) recomputes the shard plan from the monolith and compares `borough` +
`cheapestPrice` field-by-field — so stale shards **FAIL loudly**. This self-heals in
CI/deploy because `prevalidate-data`/`prebuild` run `build:slim` first, but the
**committed** shard files in the PR are wrong once #319/#320 land. #317 must be the
**last** data PR and its shards regenerated from the final dataset — its PR says
"merge after #315 (stack)", which is insufficient.

### MED-4 — #319 × #317 shard-membership shift (verified benign, budget holds)
#319 moves priced core venues into outer boroughs (e.g. `Tower Hamlets→Greenwich`,
`Barnet→Enfield`, `H&F→Hounslow`). Re-running the shard build after the repair:

| state | eager (core+manifest) | shards | budget |
|---|---|---|---|
| #317 baseline (pre-#319) | **515.0 KB** | 10 lazy | 600 KB ✓ (reproduces PR claim exactly) |
| + #319 repair | **509.3 KB** | 10 lazy | 600 KB ✓ |
| + #319 + #320 | **509.3 KB** | 10 lazy | 600 KB ✓ |

All 10 outer boroughs stay under the 40% priced-ratio / ≥20-venue lazy threshold; none
graduate to core; eager budget holds with 90 KB headroom. Membership shifts
(Greenwich 107→112, Hounslow 81→86, Newham 78→82, Enfield 78→79) — expected, harmless.

### LOW-5 — write-path serialization inconsistency
`apply_outer_london_prices.mjs` (#320) writes `${JSON.stringify(app)}\n` (trailing
newline); `repair_borough_labels.mjs` (#319) writes `JSON.stringify(rows)` (no
newline). The committed dataset's trailing byte depends on which script ran last.
Harmless once `build:slim` regenerates downstream artifacts, but a byte-determinism
wart. Recommend standardizing on one serialization.

### LOW-6 — #308 doc date-stamps to "today"
`report_borough_coverage.mjs` writes `docs/BOROUGH_COVERAGE_<today>.md`; the committed
doc is `...2026-07-17.md` but a re-run today emits `...2026-07-18.md` — won't overwrite
the committed file, leaves date-stamped duplicates. Cosmetic.

### LOW-7 — #319 blast-radius table ±1
#319 body claims `City of London 145→79`; independent rebuild gives `144→78` (one
venue, rounding). Camden 185→96, Islington 39→87, Westminster 154→205 all reproduce
exactly; venue count conserved (1919 slim rows in/out). Honesty intact.

---

## Verified-good (mechanical honesty confirmed)

- **OSM rows come from geometry already** — of the 668 rows #315 adds, `repair
  --dry` on the post-#315 dataset changes **0** of them. #315 assigns
  `primary_borough` by the same point-in-polygon classifier the repair uses, so the
  repair is a no-op on OSM rows and only touches the 610 pre-existing core rows.
  (Answers task Q1: OSM borough labels do **not** need the repair.)
- **Repair is idempotent** — apply, then `--dry` again = `reassigned: 0`.
- **#320 prices flow into lazy shards correctly** — after full-stack rebuild,
  `venues_slim.greenwich.json` carries `Boom Battle Bar cheapestPrice=5` and
  `venues_slim.newham.json` carries `Tattoo Bar cheapestPrice=6`. Both stay lazy
  (ratio ≪ 40%). ("Boom Battle Bar Ealing £6.10" is pre-existing in #315, not new.)
- **Full-stack `validate-data` PASSES** — 13 datasets, shard-union == monolith,
  eager 509.3 KB / total 807.8 KB, on the merged #315+#320+#319+#317 state.
- **#308 report is no-network + idempotent** and reproduces its claim (1246 venues /
  33 boroughs / 966 priced = 78%) off the live artifact.
- **No secret leakage** — `harvest_outer_london_prices.mjs` reads
  `process.env.FIRECRAWL_API_KEY` and sends `Bearer ${KEY}`; never hardcoded.
  Harvest log and all five diffs are free of `fc-…`/`sk-…` tokens.
- **No invented prices** — #315 adds unpriced presence pins only; #320's 2 prices are
  first-party, licence-stamped, routed through the sanctioned `drink_price_updates`
  path.

---

## Per-PR verdict

| PR | Verdict | Notes |
|----|---------|-------|
| **#308** | **MERGEABLE** | Independent, read-only, idempotent. Land anytime (LOW-6 cosmetic). |
| **#315** | **MERGEABLE** | Base of the data chain. Land first. OSM rows geometry-correct. |
| **#320** | **MERGEABLE** (after #315) | Stacked on #315, clean. 2 honest prices flow correctly. |
| **#319** | **NEEDS-FIX / NEEDS-REORDER** | Conflicts with #315/#320 (HIGH-1). Rebase onto post-#315(+#320); re-run `repair_borough_labels.mjs` + `build:slim`; commit regenerated artifacts. Then clean + honest. |
| **#317** | **NEEDS-REORDER** | Must land **last** (after #319+#320), regenerating all shard files from the final dataset (MED-3). Logic is correct; budget holds (MED-4). |

## Required amendment to docs/MERGE_ORDER_2026-07-18.md

Add this data-chain sub-order (all mutate the single source of truth
`pint_prices_app_dataset.json`; every transform is a re-runnable script, so each
"conflict" resolves by re-running the script on the merged base and committing output):

```
#308  (independent — docs/report, land anytime)
  ↓
#315  (base: +660 OSM rows)
  ↓
#320  (rebase on #315 → re-run apply_outer_london_prices.mjs → +2 prices)
  ↓
#319  (rebase on #315+#320 → re-run repair_borough_labels.mjs + build:slim → relabel 610)
  ↓
#317  (rebase on top → re-run build:slim → regenerate monolith + core + 10 shards)
```

Rationale: land every data-mutating PR before the shard split; #317's shard files are
pure derived artifacts and must be built from the final labels+prices, else
`validate-data` fails (self-heals only if `build:slim` is re-run post-merge). Proven:
the fully-stacked state builds to 509.3 KB eager and passes `validate-data` 13/13.

_Reviewed by Fable 5 (Opus 4.8, claude-opus-4-8) on branch `review/deep-data`._
