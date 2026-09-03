# Signed-in review harness

Use this harness for local browser review with one isolated PUBMAXX QA account. It uses the real Supabase project configured in `.env` or `.env.local`.

## Build and seed

Set these values in `.env` or `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service-role key local. The seed command refuses to run without the explicit local flag.

```sh
export PUBMAX_E2E_LOGIN=1
export VERCEL_ENV=development
npm run e2e:seed
```

The seed is idempotent. It resets the password, removes prior QA data and writes the new password to `.e2e/qa-credentials.json` with owner-only permissions. It does not print the password. The profile is `@e2e_qa`, with display name `QA (automated)`, and never receives a founding-member number.

Playwright builds the authenticated server itself. To build it manually for a local production-style review, run:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run build
```

## Run authenticated Playwright review

Install Chromium once, then run the authenticated project:

```sh
npx playwright install chromium
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run test:e2e -- --project=chromium-authenticated
```

The smoke spec signs in through the handle and password form, opens `/u/you`, and checks `@e2e_qa`. Reviewers can use the same form in Chrome DevTools when running the local app:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run dev
```

Open `http://localhost:3000/login`, choose the handle and password option, enter the values from `.e2e/qa-credentials.json`, then open `/u/you`. Stable selectors are `e2e-login-toggle`, `e2e-login-handle`, `e2e-login-password`, and `e2e-login-submit`.

## Tear down

Remove the QA user, profile, follows, referral edges, content, storage objects and local credentials after review:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run e2e:teardown
```

The seed and teardown refuse production Vercel environments. CI also refuses remote production targets. Never commit `.e2e/qa-credentials.json`.

## PostgreSQL test contention

The full Vitest suite starts several temporary PostgreSQL 16 sessions. A concurrent crew can exhaust macOS shared-memory identifiers, and `initdb` then reports `could not create shared memory segment: No space left on device` with `shmget`. This is shared-memory contention, not disk usage. Wait for other PostgreSQL-backed test runs to finish, then rerun `npm test` serially.
