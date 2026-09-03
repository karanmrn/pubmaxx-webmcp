# Agent state — read me first

Current to 2026-08-08. Every agent (Claude, Fable, Codex, Cursor, Grok) reads
this before it works. Update this file when the facts below change; keep it
short and true.

## Where the product stands

- Main is the truth. The 2026-08-07/08 marathon merged 130+ PRs: landing hero
  cinema + aperture splash + atmosphere motion + blueprint texture, coffee
  taxonomy end to end, map utility wave (hygiene, community signals, visit
  peek, mug-check, cheapest sort, open-now, saved-only), out-tonight beacon
  (a check-in, NOT a new table), post-claim profile page, UK national third
  map (base layer streaming, ADR 0013), Horizon 1 (pin trust explainer,
  nights kept, tonight handoff), Night OS Ask agent (grounded tool loop,
  propose-then-confirm), generative OG price-wave cards, 605 vendored skills.
- Production (Vercel project `chengdu`) deploys ONCE per day, end of day, on
  the captain's word; `vercel promote` after deploy, then verify — do not
  assume auto-assignment either way. Production may trail main during the day.
- Supabase migrations are applied by the captain's word only; the ledger is
  applied through `0084_crew_snapshot_wetherspoons_flag` (2026-08-08). A new
  migration file's timestamp must sort after every existing file.

## Laws that reviews keep catching people breaking

All binding law lives in the root `AGENTS.md` and `docs/VOICE.md`. The four
that caught real bugs this week:

1. Viewer coordinates cross ONE seam (`lib/geo.ts` `coarsenViewerPoint`)
   before any URL, log, or server. `__tests__/viewerCoordinateEgress.test.ts`
   lists every file that handles a reader fix — add yours.
2. Copy about pin colour must state the real colour stack (curated, logged,
   favourite lanes); "corroborated" belongs only to the drinker-logged lane.
3. AI surfaces use deterministic `composeAnswer` output. The model selects
   tools only; reader copy comes from returned hints and cards.
4. Every `app/api` route uses `publicApiError` (`lib/apiError.ts`) and a rate
   limit via `isLimited`. PR CI also runs lint, typecheck, and sharded unit
   tests on stock `ubuntu-latest` (`.github/workflows/ci.yml`).

## Open items

- #747 Blacksmith runner migration: closed / rejected; stock runners restored
  in `.github/workflows/ci.yml`. Do not reopen without a captain decision.
- Known follow-ups: `buildMapSearchSuggestions` complexity (45/35);
  `lib/ukBasePubSearch.ts` duplicates `lib/mapSearchSuggest.ts` ranking;
  `sanitizeEvent`'s `target` special case lives in three places.

## History

Cross-tool build history: `docs/STATE_AND_PLAN_2026-08-06.md`,
`docs/TOFABLE_2026-08-06.md`, `docs/reviews/`, `docs/plans/`.
