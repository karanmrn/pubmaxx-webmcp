# Deep Review C8 — Cross-PR corpus #323–#329 (2026-07-18)

Adversarial cross-PR review of the newest batch: **#323** (prompt orchestration),
**#324** (iOS PRD, docs), **#325** (APNs transport), **#326** (first-drop nudge),
**#327** (email digest seam), **#328** (accent-role token system), **#329** (zone
price lens). Method: mechanical wherever possible — `git merge-tree` sequential
simulation for conflicts, `git hash-object` for byte-identity claims, `vitest run`
in an APFS-cloned worktree for #325, `git show`+`grep` for token/PII/leak audits.
Nothing here is trusted from a PR description; every load-bearing claim was
re-derived.

Companion docs: `docs/MERGE_ORDER_2026-07-18.md` (the queue this amends),
`docs/DEEP_REVIEW_APP_2026-07-18.md` (#321), `docs/DEEP_REVIEW_DATA_2026-07-18.md`
(#322), `docs/PROMPT_ORCHESTRATION.md` (#323's contract).

---

## Severity-ranked findings

### P1 — none that block the batch outright
No ship-blocker on the scale of the App-review's prompt collision. The two
highest items below are a data-merge hazard (well-understood, same class as #319)
and a latent email-safety gap (inert until transport lands).

### P2-a — #329 `venues_slim.json` is the #319-class delete-on-naive-merge hazard
`public/data/venues_slim.json` — **#329 branched from `main`, not from the data
chain.** Its committed slim index is **1271 rows** (identical row-set to `main`,
just `+zone` stamped on every row); the finalized chain (#315→#320→#319→#317) is
**1919 rows**. Verified:

```
main  venues_slim = 1271 rows
#329  venues_slim = 1271 rows (main's set + zone)   [md5 of #329's base == main's]
#315  venues_slim = 1919 rows
```

Because `venues_slim.json` is single-line JSON, a 3-way merge after the chain
lands **conflicts on the whole line**, and taking #329's side silently deletes
**648 OSM venues + #320's prices + #319's relabels**. This is exactly the #319
trap. `merge-tree` onto `main` is clean *today* only because the chain is not yet
in `main`.

**Resolution (never textual):** #329's `zone` field must be **re-derived by
re-running `build:slim`** on the final dataset with #329's `stationZones`
stamping code merged in — same "⚙️ re-run a script, commit the artifact" class as
#319/#320. See the required merge position below.

### P2-b — #329 × #317 hard conflict in `scripts/build_slim_index.mjs`
Sequential `merge-tree` of #329 onto `main+#317`:

```
rc=1
CONFLICT (content): public/data/venues_slim.json      ← the P2-a hazard
CONFLICT (content): scripts/build_slim_index.mjs      ← import block + main() loop
scripts/validate-data.mjs                             ← AUTO-MERGES CLEAN ✓
```

Both PRs insert an `import { … } from "./lib/…mjs"` immediately after the
`node:url` import (#317: `slimShards.mjs`; #329: `stationZones.mjs`,
`build_slim_index.mjs:23`) and both edit `main()`. Hand-merge keeps **both**
imports and **both** bodies:
- #317 owns the write/shard stage (classify → core + 10 borough shards + manifest).
- #329 owns `const stationZones = await loadStationZones()` + the per-venue
  `zone` stamp inside the `slim.push({...})` object (`build_slim_index.mjs:537-553`).
- These are **logically compatible**: #329 stamps `zone` into each slim row
  object; #317's `classifySlimShards(slim)` slices those same row objects into
  shards, so `zone` rides into core + shards transparently in one `build:slim`.

### P2-c — #327 `{{unsubscribe_url}}` has **no substitution and no guard**
`lib/weeklyDigest.ts:449` (HTML) and `:515` (text) emit the literal
`{{unsubscribe_url}}`. `toEmailMessage()` (`:520-532`) returns it **verbatim** —
there is no per-recipient substitution, and **nothing throws** if an email ships
with the placeholder unresolved. The committed sample fixtures confirm it:
`docs/digest-samples/full-week-camden.txt` still contains the literal token.

Answer to "what guards a send with `{{unsubscribe_url}}` unresolved?": **nothing.**
The only thing preventing a literal-placeholder email *today* is that the entire
send path is an unwired no-op — `resendEmailProvider.send()` throws
"not implemented" (`lib/emailProvider.ts`), and `listOptInAudience()` returns `[]`
(`scripts/send_weekly_digest.mjs`). The moment the owner wires Resend + the
`listUsers()` audience (explicitly a "later drop-in"), a forgotten substitution
ships a broken unsubscribe link to real inboxes — a CAN-SPAM / deliverability /
spam-complaint problem.

**Fix (cheap, belt-and-suspenders):** make `unsubscribeUrl` a **required
parameter** of `toEmailMessage(digest, { unsubscribeUrl })`, substitute it there,
and assert `!/\{\{/.test(html + text)` before returning (throw on any residual
`{{`). Then a wired transport physically cannot emit an unresolved placeholder.

### P3-a — #329 reintroduces the exact anti-patterns #328 just deprecated (semantic drift)
#328 splits the one overloaded coral accent into role tokens:
`--accent-action` (loud, **CTA/Plan only**), `--accent-price` (amber brass-plaque,
**theme-stable, never coral**), `--state-active-*` (low-chroma "you are here"
*whisper*), `--badge-*` (neutral-strong counts/metadata). #329 branched from
`main`, uses **32 raw `--brass` refs** across its new CSS and **zero** of #328's
role tokens. Three concrete drifts (all the anti-patterns #328 exists to kill):

| Where | What it does | #328 role it should use |
| --- | --- | --- |
| `components/zones/zonePintIndex.css` `.zonePintCell.isPriced` | **price** cell carries a `--brass` wash → coral-for-price in light theme | `--accent-price` / `.price-plaque` (amber, theme-stable) |
| `zonePintIndex.css` `.zonePintCell.isActive` + `zonePicker.css` `.zoneChip.isOn` | selected filter state uses full `linear-gradient(--brass,--brass-bright)` loud accent → "you are here" *shouts* | `--state-active-surface/border/ink` (whisper) |
| `pubsGallery.css` `.pubsZone` (`+`296) + `zonePintIndex.css` `.zonePintCellZone` | a zone **count/metadata** pill tinted with `--brass` | `--badge-surface/border/ink` (neutral) |

Not functional; pure design-consistency. But #329 adds *new* price + selected +
badge surfaces that re-establish exactly the "one colour does every job" problem
#328 removes. If #328 lands first (recommended), a reviewer should require #329
to migrate these to role tokens on rebase — otherwise the token system is
diluted the same day it ships.

### P3-b — #326 nudge accent is *consistent in intent*, uses raw tokens (minor)
`app/globals.css` `.firstDropNudgeCta` uses `linear-gradient(--brass,--brass-bright)`
+ `--color-on-accent`. This **is** a genuine CTA (contribute the first price), so
under #328 the loud accent is *licensed* here — no coral-for-price violation (the
nudge occupies the empty-price slot; it carries no price). The dashed
`--brass 40%` container reads as an accent-tinted invitation, conceptually the
same family as `--state-active-surface` (brass 9%). **Verdict: consistent with
#328's roles.** Only nit: it hard-codes `--brass`/`--brass-bright` instead of the
new `--accent-action`/`--accent-action-strong` aliases — a one-line swap on rebase,
same as every other CTA consumer #328 leaves for later.

### P3-c — #325 "zero new dependencies" is true for the transport, not the PR
The APNs transport genuinely adds **no** dependency — `lib/pushProvider.ts` signs
ES256 with `node:crypto` and speaks HTTP/2 with `node:http2`. But the PR's
`package.json` adds `@capacitor/camera`, `@capacitor/push-notifications`, and
`@capacitor/cli/core/ios`. Those are inherited from the #295→#300 stack this
branch sits on (relative to #300 the increment is zero deps). The title is
accurate about the *transport*; a reader diffing against `main` will see five new
deps. Informational.

---

## Per-PR verdicts

### #323 fix/prompt-orchestration — **APPROVE.** Every claim verified.
- `lib/promptBudget.ts` **byte-identical** to `feat/a2hs-flow`
  (`git hash-object` = `330f6a0f…` on both); `__tests__/promptBudget.test.ts`
  identical too. So #313 rebases both files to a genuine no-op. ✓
- `promptBudget.ts` is **absent on `main`** — #323 legitimately introduces it; no
  pre-existing-file conflict. ✓
- #313's `A2HSInstallPrompt.tsx` already adopts correctly (surface `"a2hs"`,
  `hasPromptBudgetFor`+`claimPromptBudget` on show, defers to `hasSeenTour()`). ✓
- #312's `lib/identityNudge.ts` really exports `isIdentityNudgePending()` +
  `recordPlanNudgeTrigger()`; the `PlanCrew.tsx` co-arm is real. ✓
- The contract (respect → claim-on-show → keep-on-dismiss → degrade-open, priority
  `identity > push > A2HS`) is sound. The **adoption debt is the only risk**: the
  merge-order checklist does not yet spell out the per-component adoptions #312
  and #299 must apply on rebase (see amendment E5 below). This is bookkeeping, not
  a code defect.
- Note: #313's A2HS imports `hasSeenTour` from `@/lib/firstRunTour`, which #323
  edits additively (+39 lines, export-only) — import stays valid. ✓

### #325 feat/apns-transport — **APPROVE.** Crypto claims hold; tests green.
- **Tests run in an APFS-cloned worktree:** `pushProvider` 25/25, and
  `pushProvider + pushSender + pushTokenStore + pushTokensRoute + pushEventHooks`
  **54/54 passing**.
- **JWT window math is correct — no off-by-one.** `JWT_REUSE_MS = 50min`;
  `getCachedJwt` reuses while `now - iatMs < 50min` (strict `<`, refresh at 50).
  Apple's floor (`TooManyProviderTokenUpdates`, ~20min min between generations) is
  respected because a new token is only signed on cache miss/expiry, i.e. **≥50min
  apart** > 20. Apple's ceiling (`ExpiredProviderToken`, >1h) is respected because
  the oldest a token is *used* is <50min < 60. 50 sits comfortably inside (20, 60)
  with a 10-min margin both sides. (`iatMs` is wall-ms while the `iat` claim floors
  to seconds — a <1s discrepancy, negligible.)
- **Session close on partial failure: correct.** `createApnsPushProvider.send`
  wraps the `Promise.all(tokens.map(sendOne))` in `try { … } finally { transport.close() }`.
  `sendOne` catches per-token transport failures into an `error` *result* (never
  throws), so `Promise.all` never rejects and `close()` always runs exactly once.
  If `sessionFactory` throws at open, it returns an all-error summary with no
  transport to close. ✓
- **Malformed `APNS_PRIVATE_KEY` cannot leak.** `createPrivateKey()` throws a
  generic decoder error that does not echo key bytes; it propagates up to
  `pushSender.dispatch`, which logs only `err.message` (`lib/pushSender.ts`). No
  path logs the key material, the config, or the JWT. Token logs are truncated to
  `…${token.slice(-6)}`. ✓
- Good defensive posture throughout: `resolvePlanTokens()` returns `[]` (won't
  broadcast plan-scoped events to all devices — documented privacy leak avoided);
  at-most-once broadcast consumes the durable claim *before* send (drops a
  broadcast rather than duplicating).

### #326 feat/first-drop-nudge — **APPROVE.** Token intent consistent (P3-b).
Independent feature. `app/globals.css` additions append at ~2902 (clean vs #328's
edits at 70/257/327). Accent usage is intent-correct for #328 (CTA gets the loud
accent). Migrate raw `--brass` → `--accent-action` on rebase after #328.

### #327 feat/email-digest — **APPROVE with the P2-c fix required before transport wiring.**
- **Recipient resolution is service-role-only and privacy-first.** The documented
  audience path is `admin.auth.admin.listUsers()` gated on
  `SUPABASE_SERVICE_ROLE_KEY` (`scripts/send_weekly_digest.mjs`
  `isRecipientSourceConfigured`); emails live only in Supabase Auth. No
  client-reachable recipient read exists (it's a documented seam;
  `listOptInAudience()` returns `[]`). ✓
- **Opt-in gate correct:** `isDigestOptedIn` — opt-out **always wins** over opt-in
  (`lib/weeklyDigest.ts:311-318`); `resolveDigestRecipients` drops anyone without a
  valid email or opt-in. ✓
- **No PII in logs or fixtures.** `noopEmailProvider` logs subject + count, never
  addresses; the send script logs counts only. All test/fixture emails are
  synthetic (`example.com`, `e.com`); the sole real address is the brand From
  `hello@pubmaxxing.com`. ✓
- **The one gap is P2-c:** unsubscribe placeholder ships unresolved with no guard.
  Inert today; fix before delivery is wired.

### #328 design/token-system-v2 — **APPROVE.** Clean, additive, well-reasoned.
Pure additive role aliases over the existing palette + one gradient replacement +
the PriceBadge migration (coral → brass-plaque). Edits `globals.css`/`theme.css`/
`PriceBadge.module.css` in regions that don't collide with #326 or #329. The value
is only realized if downstream consumers adopt the roles — flag #329 (P3-a) and
CTA sites (#326 P3-b) to migrate on rebase.

### #329 feat/zone-price-lens — **APPROVE conditional on merge position + regen + token migration.**
Blocked behind the full data chain (P2-a/b). `scripts/validate-data.mjs`
auto-merges cleanly — #329's `zone` integrity check (in `validateSlimVenues`,
reads the monolith, asserts `zone` is int 1–9) and #317's `validateSlimShards`
(reads shards, asserts structural equality — id union, count, bbox, budgets; it
does **not** field-check `zone`) operate on **different artifacts and different
fields**, so there is **no conflict** between them. Required position + regen
below; token drift is P3-a.

---

## #329 required merge position (task item 1, answered)

**#329 must land AFTER the entire data chain including #317**, and its merge is a
scripted regen + one hand-merge, never a textual `venues_slim.json` merge:

```
… #315 → #320 → #319 → #317  (the strict data chain, per MERGE_ORDER §E1)
                         ↓
                       #329   (after #317)
   1. Hand-merge scripts/build_slim_index.mjs: keep BOTH #317's shard
      imports/write-stage AND #329's stationZones import + per-venue zone stamp.
   2. Run `npm run build:slim` → regenerates venues_slim.json (1919 rows, now
      +zone) + venues_slim.core.json + 10 borough shards + manifest, zone riding
      into every shard automatically.
   3. `npm run validate-data` must pass (zone check on monolith + shard structural
      check both green).
   ⚠️ DO NOT take #329's side of the venues_slim.json conflict — that deletes 648
      OSM venues + #320's prices + #319's relabels.
```

Does #317's sharding carry `zone` correctly? **Yes** — `classifySlimShards` slices
the in-memory slim row objects (which now carry `zone`) into core + shards, and
`buildShardManifest` never strips fields. Does the zone integrity check conflict
with #317's shard validator? **No** — proven clean above.

---

## Merge-order amendment draft (task item 6)

Append these to `docs/MERGE_ORDER_2026-07-18.md`. Two parts: (E5) the #323
adoption checklist Sol was missing, and (F) the #324–#329 order extension.

### E5 — #323 prompt-budget adoption checklist (append to §(e))

> **E5 — `fix/prompt-orchestration` is now #323; its adoption debt is per-branch.**
> #323 brings `lib/promptBudget.ts` to `main` byte-identical to `feat/a2hs-flow`
> (verified) and makes the first-run tour claim the budget. The other three
> surfaces still need their ~4-line adoption applied **at rebase time** (diffs in
> `docs/PROMPT_ORCHESTRATION.md`). The queue steps must carry these sub-tasks:
>
> - **Step 24 (#312 identity-nudges):** on rebase, edit
>   `components/identity/IdentityNudge.tsx` — import `claimPromptBudget`,
>   `hasPromptBudgetFor`; gate `canShow` on `hasPromptBudgetFor("identity-nudge")`;
>   `claimPromptBudget("identity-nudge")` in a `useEffect` when it shows. Effect
>   sits **before** the early return (rules-of-hooks).
> - **Step 25 (#313 a2hs-flow):** **no-op** for orchestration — its
>   `promptBudget.ts` + test are already on `main` identical (rebases to empty);
>   `A2HSInstallPrompt.tsx` already adopts surface `"a2hs"`. Verify no diff on
>   those two files; nothing to add.
> - **Step 29 (#299 native-first-run):** on rebase, edit
>   `components/native/NativePushPrompt.tsx` — same shape, surface `"native-push"`:
>   gate `canShow = visible && hasPromptBudgetFor("native-push")`, claim in a
>   `useEffect`. **AND** resolve `PlanCrew.tsx:158` by intent (already noted in
>   §(c)): `recordPlanNudgeTrigger()` first, then `recordPlanHighIntentAction()`
>   only `if (!isIdentityNudgePending())`; the #299 push call goes **inside** that
>   guard. Union imports: `isIdentityNudgePending, recordPlanNudgeTrigger` from
>   `@/lib/identityNudge`; `recordPlanHighIntentAction` from `@/lib/nativePushPrompt`.
> - **Acceptance:** after #312/#313/#299 land, all four surfaces
>   (`first-run-tour`, `identity-nudge`, `native-push`, `a2hs`) call
>   `hasPromptBudgetFor` + `claimPromptBudget`. Grep proof:
>   `grep -rl claimPromptBudget components/` returns 4 components.

### F — Total-order extension for #323–#329 (append after step 30)

> Step **22** in §(b)/§(d) is now **#323** (was "fix/prompt-orchestration, no PR #
> yet") — no position change, just the number. New PRs slot as follows:
>
> | # | PR | Branch | Tier / why here |
> |---|----|--------|-----------------|
> | 2b | #324 | docs/ios-app-prd | **Docs-only, zero risk.** Land anytime with the other docs (near steps 1–4). |
> | 9b | #328 | design/token-system-v2 | **Land right after the data chain, before #326/#329.** Additive role tokens over the palette; order-independent mechanically, but landing it *before* the accent consumers lets review flag drift (see below). Co-touches `globals.css` with #326/#329 in disjoint regions → clean. |
> | 31 | #329 | feat/zone-price-lens | **After #317 (hard data dependency).** ⚠️⚙️ Hand-merge `scripts/build_slim_index.mjs` (keep #317 shards + #329 zone stamp) → `npm run build:slim` to regenerate monolith + core + 10 shards + manifest with `zone` → `npm run validate-data` green. **DO NOT take #329's side of the `venues_slim.json` conflict** (deletes 648 OSM venues + #320 prices + #319 relabels). On rebase, migrate `zonePintIndex.css`/`zonePicker.css`/`pubsGallery.css` off raw `--brass`: prices → `--accent-price`, selected states → `--state-active-*`, zone pills → `--badge-*` (P3-a). |
> | 32 | #326 | feat/first-drop-nudge | Independent inspector feature. `globals.css` appends clean. On rebase swap the CTA's raw `--brass` → `--accent-action` (P3-b). |
> | 33 | #327 | feat/email-digest | Fully independent (new lib + scripts + workflow, no shared edits). Land anytime. **Before wiring the Resend transport, apply the P2-c fix: `toEmailMessage` must require + substitute `unsubscribeUrl` and assert no residual `{{`.** |
> | 34 | #325 | feat/apns-transport | **Stack top — after #300 (step 30).** Branches off the #295→#300 native stack; clean once #300 is in. Real ES256/HTTP2 transport replacing #300's seam; 54/54 push tests pass. |
>
> **Conflict deltas added by this batch:** one new scripted data stop (#329, same
> class as #319 — regen, never textual) and one new code hand-merge inside it
> (`build_slim_index.mjs` imports+loop vs #317). #328/#326/#327 add **no** new
> textual conflicts. #325 is a clean stack rebase. Net: the batch adds **1 scripted
> stop + 1 small hand-merge**, both inside #329.

---

## Mechanical appendix (commands re-run for this review)

- `git merge-tree --write-tree --name-only main <branch>` — isolation cleanliness.
- `git commit-tree $(git merge-tree --write-tree main <#317>) -p main` then
  `git merge-tree --write-tree --name-only <that> <#329>` — the #329×#317
  sequential simulation (rc=1, the two conflicts above; validate-data auto-clean).
- `git show <branch>:public/data/venues_slim.json | python3 -c 'len(json.load…)'`
  — 1271 vs 1919 row counts; md5 of #329's base == `main`.
- `git hash-object --stdin` on `promptBudget.ts` / `.test.ts` for #323 vs #313 —
  `330f6a0f…` both.
- `cp -c -R node_modules` (APFS clone) into a worktree of `feat/apns-transport`,
  then `npx vitest run __tests__/push*` — 54/54.
- `grep -c -- '--brass'` on #329's new CSS — 12 + 7 + 13 = 32 raw refs, 0 role tokens.
