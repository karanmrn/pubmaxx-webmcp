# Social freeze runbook (solo-operator emergency path)

Probe U15 (`docs/UNKNOWNS_MAP_2026-07-21.md`): one owner, no moderators. This is
the switch that makes the social **write** surfaces read-only instantly during a
safety or abuse incident, without a code deploy. It freezes the surface so you do
not have to work a review queue that no staffing exists for.

The whole switch is one environment variable: **`PUBMAX_SOCIAL_FREEZE`**.

| Value | Effect |
|---|---|
| unset / `off` / anything else | Normal operation (fails safe to off) |
| `social` | Social mutations return `503 { code: "SOCIAL_FROZEN", retryable: true }`; reads keep working |

## When to flip it

Flip to `social` when, overnight and alone, you see any of:

- Abusive or unsafe content being posted faster than you can hide it one by one.
- A spam or automation flood across check-ins, pint drops, comments, DMs, or follows.
- A safety incident where the safest immediate move is "stop new posts, keep the
  app readable" while you assess.

It is a blunt, reversible instrument. Flip it, breathe, then triage. It is cheaper
to freeze for ten minutes and unfreeze than to fight a flood by hand.

## Exactly where in Vercel

1. Vercel dashboard → the production project (`chengdu` serves pubmaxxing.com; the
   `pubmax` project mirrors it). Do both if both are live.
2. **Settings → Environment Variables.**
3. Add or edit `PUBMAX_SOCIAL_FREEZE` for the **Production** environment, value
   `social`. (Add it to Preview too if an incident is on a preview URL.)
4. **Redeploy** so the running deployment picks up the new value: Deployments →
   latest production deployment → **Redeploy** (no rebuild of your own code is
   required; this is an env change only). A redeploy is the one step beyond the
   env edit and takes a couple of minutes.
5. Verify: any social POST (for example, post a check-in from your phone) should
   return the paused message; reading the feed should still work.

There is no separate app deploy, no migration, and no database change.

## What stays up (deliberately)

Reading is untouched: every `GET` keeps serving, so the feed, profiles, stories,
plans, and discovery all render normally.

These **safety and legal floors stay OPEN even while frozen** and were wired to
sit outside the guard on purpose:

- **Reporting** a pint drop (`action: "report"` on `POST /api/pint-drops`).
- **Reporting** a message (`action: "report"` on `POST /api/messages/[id]`).
- **Moderation** actions you take as owner (`restore` / `keep_hidden` on
  `POST /api/pint-drops`) — you must be able to hide content *during* a freeze.
- **Account deletion** (`DELETE /api/profiles/[handle]`) — a legal floor; a user
  must always be able to leave.

**Plan collaboration is intentionally NOT frozen.** Crew plans
(`/api/plans/...`) are private, time-sensitive coordination surfaces. Freezing
them mid-night would strand a group that is out together right now. A social
freeze is about public/broadcast abuse, not stranding a private crew, so the
plan routes keep working. Night-story *consent* and *contributor* management is
left open for the same reason (private coordination, not broadcast).

### Frozen surfaces (the guarded write families)

| Family | Route(s) |
|---|---|
| Check-ins | `POST /api/check-ins` |
| Pint drops — create | `POST /api/pint-drops` (create path only) |
| Pint drops — comment | `POST /api/pint-drops/comments` |
| Pint drops — react | `POST /api/pint-drops/reactions` |
| Messages — send | `POST /api/messages`, send branch of `POST /api/messages/[id]` |
| Follows | `POST /api/profiles/[handle]/follow` |
| Night moments | `POST /api/night-memories/[id]/moments`, `POST /api/night-stories/[id]/moments` |
| Story create + publish | `POST /api/night-stories`, `.../publish-proposals`, `.../publish-confirmations` |

The seam is `lib/opsFreeze.ts`; the containment fence in
`__tests__/opsFreeze.test.ts` fails CI if a guarded family stops calling it.

## What to tell users

The app tells them for you, in the house voice (value first, no apology):

> Reading stays open. Posting is paused for a bit while we sort something out.

If you post anything yourself (status page, pinned note, social), keep the same
shape: say what still works first, be honest that posting is paused, give no fake
timeline. Do not apologise first and do not over-explain the incident.

## How to unfreeze

1. Vercel → same project → Environment Variables → set `PUBMAX_SOCIAL_FREEZE`
   back to `off` (or delete the variable).
2. Redeploy the production deployment again.
3. Verify a social POST succeeds. Writing is live again immediately.

Because unset and `off` both mean "normal", deleting the variable is a clean
reset.

## Escalation list (owner to fill in)

Fill these in before you need them; keep a copy off-device (phone notes / paper):

- **Owner on call:** _<name / phone>_
- **Backup contact:** _<name / phone>_
- **Hosting (Vercel) account + 2FA recovery:** _<where>_
- **Supabase project owner / dashboard:** _<where>_
- **Domain registrar (pubmaxxing.com):** _<where>_
- **Legal / safeguarding contact (CSAM, threats, self-harm):** _<who to call, and
  the reporting line for the relevant jurisdiction>_
- **Payments / abuse contact (if a paid feature is being abused):** _<where>_
