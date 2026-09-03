-- Email subscribers (0042): durable backing for the LIGHTWEIGHT email capture on
-- the identity nudge sheet (Cycle-2 locked owner decision: "push identity harder
-- — early email capture"). A signed-out user who does not want full OAuth can
-- instead leave just an email to receive the weekly pint digest. Apply AFTER
-- 0041 (infra/production-readiness: visit_reports_author_index). House style
-- mirrors 0025_price_confirms:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO public/raw policy — the service-role route is the ONLY
--     reader/writer; emails are PII and never leave the API boundary. No anon /
--     authenticated SELECT/INSERT/UPDATE/DELETE policy exists on purpose.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the integrator applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/emailSubscribersStore.ts fails soft to process-memory, so capture keeps
-- working and becomes durable the moment this lands (no code change needed).
--
-- DOUBLE-OPT-IN STANCE (GDPR-sane, one stated purpose):
--   • Every capture stores `confirmed = false`. The row is a PENDING subscriber,
--     NOT a mailing-list member. The weekly digest (feat/email-digest, #327)
--     treats an UNCONFIRMED subscriber as NOT opted in — see the recipient seam
--     doc in lib/emailSubscribersStore.ts + docs/EMAIL_CAPTURE.md. Only a
--     confirmed subscriber may ever be mailed.
--   • `unsubscribe_token` is a per-row opaque secret minted at capture. It backs
--     BOTH the confirm link and the unsubscribe link (one token, two verbs), so
--     no email address ever travels in a URL. API-only — hence RLS with no read
--     policy.
--   • `source` records where the capture happened ('identity-nudge' today) for
--     honest provenance / purpose limitation; the column is constrained to a
--     known allowlist so a spoofed body can't invent a source.
--
-- Model notes:
--   • `email` is stored lower-cased + trimmed (the store normalises before write)
--     and is UNIQUE: a re-submission of the same address is an idempotent UPSERT
--     that refreshes `updated_at`, never a duplicate row and never a silent
--     re-confirm (a already-confirmed row stays confirmed; an unconfirmed row
--     stays unconfirmed until the confirm link is followed).
--   • Confirmation email SENDING is provider-gated (noop until RESEND_API_KEY /
--     EMAIL_FROM exist — the same seam as lib/emailProvider.ts on the digest
--     branch). The flow is built and inert; no row is auto-confirmed.

create table if not exists public.email_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  source            text not null default 'identity-nudge',
  confirmed         boolean not null default false,
  unsubscribe_token text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  unique (email),
  unique (unsubscribe_token)
);

-- Source allowlist: only known capture surfaces may write. Keeps provenance
-- honest and blocks a spoofed body from inventing an arbitrary source string.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_subscribers_source_check'
  ) then
    alter table public.email_subscribers
      add constraint email_subscribers_source_check
      check (source in ('identity-nudge'));
  end if;
end $$;

-- Defence-in-depth address sanity at the storage boundary (the store + route
-- validate first). Rejects empty / spaceful / @-less strings; the real format
-- rule lives in lib/emailSubscribers.ts.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_subscribers_email_check'
  ) then
    alter table public.email_subscribers
      add constraint email_subscribers_email_check
      check (position('@' in email) > 1 and email = lower(email) and length(email) <= 254);
  end if;
end $$;

-- The digest recipient resolution (#327) scans CONFIRMED subscribers only; a
-- partial index keeps that scan tight as the unconfirmed/pending set grows.
create index if not exists email_subscribers_confirmed_idx
  on public.email_subscribers (confirmed)
  where confirmed = true;

alter table public.email_subscribers enable row level security;

drop policy if exists email_subscribers_public_read on public.email_subscribers;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated
-- roles: email addresses and unsubscribe tokens are PII / secrets, API-only, and
-- the service-role route bypasses RLS. Service-role only, by construction.
