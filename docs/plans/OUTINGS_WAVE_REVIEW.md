# Outings waves S1–S4 — code review (iteration)

Reviewed branch `cursor/first-principles-outings-plan-dd0b` after Waves S1–S4 landed. Findings below drove the follow-up patch in this PR.

## Verdict

Ship-worthy direction. Story and landing read human without inventing biography. Coffee taxonomy + migration `0082` are mostly wired. Plan chips were verified keyless. Open Pubs scaffold correctly refuses slim merge.

Gaps that mattered were **taxonomy follow-through** (text classifier + Wetherspoons section map still treating soft drinks as `other`) and **outing copy inconsistency** on `/plan` after describe-first moved to outing language.

## Critical / important (fixed this iteration)

| Finding | Where | Fix |
|---|---|---|
| Soft drinks section mapped to `other` | `lib/wetherspoons.ts` `CATEGORY_RULES` | Map soft drinks → `soft-drink`, AF → `alcohol-free`, coffee/hot drinks → `coffee` |
| Feed/text classifier had no AF / soft-drink / coffee keywords | `lib/drinkCategoryFromText.ts` | Add lanes above the beer net; keep espresso martini as vodka |
| `/plan` still said “night” after describe-first said “outing” | `app/plan/page.tsx`, `PlanComposer.tsx`, e2e locators | Align user-facing outing copy; update e2e |

## Suggestions (not blocking)

1. **Captain applies `0082`** before coffee submits hit production Supabase.
2. **Owner biography dump** still needed if `/about` should name more of the team / scars.
3. **Open Pubs full CSV evaluate** (`npm run evaluate:open-pubs -- --download`) — report only; use match rate to decide curator queue, never auto-merge.
4. **Onboarding / MobilePlanActivation** still say “Plan my night” in places — leave until a dedicated map-sheet outing pass (different surface, different e2e).
5. **API error** `Describe the night or add its time…` on generate route — domain `NightContext` vocabulary; optional later soften.
6. **Coffee density** — do not seed prices; borough campaign + submit UX is the honest path.

## What already looked solid

- Migration CHECK mirrors `DRINK_CATEGORIES` (pinned in `__tests__/drinks.test.ts`)
- Coffee in `SUBMITTABLE_DRINK_CATEGORIES` and map lens; not in `NO_ALCOHOL_DRINK_CATEGORIES` (correct — coffee is not the no-alcohol lens)
- Discover `CategoryShowcase` explore mode derives from `MAP_LENS_DRINK_CATEGORIES` so coffee cards appear automatically
- Open Pubs helpers: no network in unit tests; dry-run CLI only
- About refusals section grounded in real product decisions

## Next build queue (ranked)

1. Coffee empty-state copy / legend noun polish when lens selected (reuse `drinkLens*` helpers)
2. Price-submit e2e row for coffee (after migration on envs that hit Supabase)
3. Run Open Pubs evaluate against curated London identity; file curator tickets from unmatched high-confidence rows
4. PLG Wave 1 (WhatsApp-first invite) — separate plan, highest growth leverage once outing surfaces are coherent
