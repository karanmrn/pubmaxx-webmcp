# Runbook: Supabase Preview branch check

_Last updated 2026-07-07. Owner: whoever holds the linked Supabase project._

## Problem this fixes

The Supabase GitHub integration's **Supabase Preview** check failed on `main`
with:

```
Remote migration versions not found in local migrations directory.
```

### Root cause (confirmed from CLI source)

The integration parses a leading version from each local filename in
`supabase/migrations/` using the regex `^([0-9]+)_(.*)\.sql$`
(`pkg/migration/file.go`) and compares that version — by **string equality** — to
each `version` in the remote `supabase_migrations.schema_migrations` ledger
(`FindPendingMigrations` in `pkg/migration/apply.go`). The `_name` suffix is
never compared; **only the leading digits (the "timestamp") matter.**

Two mismatches caused the failure:

1. **Filename scheme drift.** Local files were named `0001_visit_reports.sql`
   (4-digit prefix) while the remote ledger stores 14-digit timestamps like
   `20260705214432`. `"0001" != "20260705214432"`, so every remote version
   looked "missing locally" and the check raised `ErrMissingLocal`.
2. **Remote-only ledger entries with no local file at all:**
   - `20260705214936_0007_function_search_path` — applied early via MCP/SQL
     editor, never captured as a repo file.
   - `20260706102502` name `pub_presence` — the local `0007_pub_presence.sql`
     applied under a bare (numberless) name.
   - `0013`/`0014`/`0015` each appear **twice** in the ledger (an early set at
     `2026070701xxxx` and a re-applied set at `2026070705xxxx`).

## The fix that is in the repo (durable, no remote DB edit)

Every local migration file was renamed to `<remote_version>_<name>.sql` so its
parsed prefix matches the remote ledger character-for-character, and a local
file was added for every remote version that lacked one:

| Remote version   | Local file                                        | Note |
| ---------------- | ------------------------------------------------- | ---- |
| 20260705214432   | `20260705214432_0001_visit_reports.sql`           | renamed |
| …                | (0002–0006 renamed 1:1)                           | renamed |
| 20260705214936   | `20260705214936_0007_function_search_path.sql`    | **new** — reconstructed from ledger SQL |
| 20260706102502   | `20260706102502_0007_pub_presence.sql`            | renamed (was bare `pub_presence` remotely) |
| …                | (0008–0012 renamed 1:1)                           | renamed |
| 20260707010745   | `20260707010745_0013_comment_replies.sql`         | renamed (early copy) |
| 20260707010750   | `20260707010750_0014_realtime_publication.sql`    | renamed (early copy) |
| 20260707010941   | `20260707010941_0015_index_cleanup.sql`           | renamed (early copy) |
| 20260707053307   | `20260707053307_0013_comment_replies.sql`         | **new** — idempotent re-apply copy |
| 20260707053327   | `20260707053327_0014_realtime_publication.sql`    | **new** — idempotent re-apply copy |
| 20260707053355   | `20260707053355_0015_index_cleanup.sql`           | **new** — idempotent re-apply copy |
| 20260707053408   | `20260707053408_0016_drinks.sql`                  | renamed |
| …                | (0017–0020 renamed 1:1)                           | renamed |

**Why the duplicate 0013/0014/0015 files are safe:** each body is idempotent
(`add column if not exists`, `create index if not exists`, guarded
`do $$ … if not exists … $$`), so a fresh preview branch re-running the same
statement twice is a no-op — no `42710 duplicate_object`, no data change.

Local parsed versions now equal the remote ledger set exactly (24 = 24), so
`FindPendingMigrations` finds no unmatched remote version and the check passes.
**No production schema or ledger was touched to achieve this.**

## Intentional duplicate 0013 / 0014 / 0015 re-application files

**Do not delete these migration files casually.** Supabase Preview compares the
remote `schema_migrations` ledger to local filenames by leading version digits
only. Preview currently has *two* ledger rows for each of 0013, 0014, and 0015:

| Logical migration | Early ledger version | Later (re-apply) ledger version |
| ----------------- | -------------------- | ------------------------------- |
| 0013 comment replies | `20260707010745` | `20260707053307` |
| 0014 realtime publication | `20260707010750` | `20260707053327` |
| 0015 index cleanup | `20260707010941` | `20260707053355` |

The repo therefore keeps **both** files for each pair (early + re-apply). The
re-apply bodies are intentionally idempotent (`if not exists` / guarded `do $$`),
so a fresh Preview branch that runs both is a no-op on the second pass.

### How to reconcile Preview drift (actionable)

1. **If Preview fails with `Remote migration versions not found in local migrations directory`:**
   confirm every remote version in the table above still has a matching
   `supabase/migrations/<version>_*.sql` file. Restore from git if a file was
   removed — do **not** invent a new timestamp.
2. **If a human wants a single ledger row per logical migration:** use the
   optional `migration repair` steps below (remote edit only). After repair,
   delete *only* the local files whose versions you marked `reverted`, and keep
   the surviving set paired 1:1 with the ledger.
3. **Never** delete one half of a duplicate pair while both versions remain in
   the remote ledger — that reintroduces `ErrMissingLocal` on the next Preview.
4. **Never** run `repair --status reverted` on a singular migration that has no
   sibling copy (e.g. `0007_function_search_path`, `pub_presence`).

## Optional: collapse the duplicate ledger entries (remote edit — run by a human)

The in-repo fix above is complete and requires nothing below. If you would
rather have a *clean* ledger with the three duplicate 0013/0014/0015 entries
removed (so you can then also delete the three `*_2026070705xxxx_00xx_*.sql`
duplicate files), run `migration repair` against the **linked remote project**.

> `supabase migration repair` updates ONLY the `schema_migrations` tracking
> table — it does not run or revert any SQL. It is safe in that it won't alter
> your schema, but it DOES rewrite migration history, so a human should run it
> deliberately. **These commands are documented, not executed, by automation.**

First link the project (one-time):

```bash
supabase link --project-ref iankajxliutqogqkmvdg
```

Then mark the three **early** duplicate versions as reverted so only the
re-applied set remains in the ledger:

```bash
supabase migration repair --status reverted 20260707010745   # 0013 early copy
supabase migration repair --status reverted 20260707010750   # 0014 early copy
supabase migration repair --status reverted 20260707010941   # 0015 early copy
```

Verify:

```bash
supabase migration list        # remote should now list 0013/0014/0015 once each
```

After a successful repair, you may delete the corresponding early-copy files
(`20260707010745_0013_comment_replies.sql`,
`20260707010750_0014_realtime_publication.sql`,
`20260707010941_0015_index_cleanup.sql`) — or, symmetrically, revert the *later*
versions instead and delete the later files. Keep whichever set you leave in the
ledger paired with a local file. **Do not** run `repair --status reverted` on a
version that has no sibling copy (e.g. `0007_function_search_path`,
`pub_presence`, or any singular migration) — that would reintroduce the original
`ErrMissingLocal` failure.

## Verifying the check locally (optional)

If you link the project you can reproduce the integration's comparison:

```bash
supabase link --project-ref iankajxliutqogqkmvdg
supabase migration list        # LOCAL and REMOTE columns should align row-for-row
```

Without a linked project / DB URL, `migration list` cannot reach the remote and
will error — that is expected in CI/sandbox and does not indicate a problem.
