# Connected Social Accounts Implementation Plan

> **For agentic workers:** Use test-driven development for every provider capability and deletion behavior.

**Goal:** Let users link lawful external profiles and selectively import approved public content without promising universal social sync.

**Architecture:** Keep `external_social_accounts` as the only connection store. Add an explicit capability matrix per provider. Manual public links are the universal fallback. OAuth, content reads, and publishing stay separate capabilities with separate consent and expiry.

Bind each OAuth provider subject to the stable PUBMAXX User ID from the live Supabase session (`callerUserId` / `requireVerifiedSocialActor`). Clerk is optional and two-key gated; a Clerk session is not a PUBMAXX User ID. Treat pasted handles and URLs as provenance only. Protected Social reads and publishing require that session, a claimed handle, and `accountIsAdult`. Ownership and visibility stay server-enforced. Add fail-closed tests for mismatched, suspended, and unverified accounts.

## Provider contract

| Provider | v1 capability | External gate |
|---|---|---|
| Instagram | Manual link now; professional-account OAuth later | Meta app, callback, review, advanced access, encryption key |
| TikTok | Manual link now; authorised profile and selected-video reads later | TikTok developer approval and Display API scopes |
| Letterboxd | Manual profile link and outbound badge | Letterboxd API approval before any data use |
| X | Manual link now; authorised public-post metadata later | X developer project and paid/read access as applicable |
| YouTube, Spotify, Snapchat, Strava, LinkedIn, website | Manual public link only | No import claim |

## Task 1: Capability and lifecycle contract

**Files:**
- Modify: `lib/socialConnections.ts`
- Modify: `lib/socialOAuth.ts`
- Create: `lib/socialProviderCapabilities.ts`
- Create: `__tests__/socialProviderCapabilities.test.ts`
- Modify: `__tests__/socialConnections.test.ts`
- Modify: `__tests__/socialOAuthState.test.ts`

- [ ] Write failing tests that separate `manual_link`, `oauth_identity`, `read_selected_content`, and `publish`.
- [ ] Make UI read the matrix. Never infer capability from presence of a client ID alone.
- [ ] Store capability-keyed grant metadata (consent version, expiry, refresh status, fetched time, upstream revocation). One provider row with one `scopes` array and one `token_expires_at` cannot represent independent grants.
- [ ] Keep token fields inapplicable to `manual_link`.
- [ ] Test partial grants, per-capability revocation, and reauthorization.
- [ ] Keep OAuth `state` owner-bound and single-use. Use provider-specific PKCE. Validate the provider account identity before writing `external_social_accounts`.
- [ ] Add tests for provider-mismatched state, replay, and callback account mismatch.

## Task 2: Safe deletion and disconnect

**Files:**
- Create: `supabase/migrations/<timestamp>_social_connection_lifecycle.sql`
- Modify: profile deletion/export stores and routes.
- Modify: `app/api/social-connections/[provider]/route.ts`
- Create: `__tests__/socialConnectionDeletion.test.ts`

- [ ] Write failing tests for disconnect, profile deletion, export, token ciphertext removal, and upstream revocation retry.
- [ ] Deny refresh, read, and publish access immediately on disconnect, even if upstream revocation is still in flight.
- [ ] Retry upstream revocation with server-only encrypted credentials, idempotent and bounded. Remove ciphertext after successful or terminal cleanup.
- [ ] Keep a minimal audit code, never token material or imported provider payload.
- [ ] Cover transient failure, retry, terminal cleanup, erasure, and credential-free export.

## Task 3: Provider certification

- [ ] Provision `SOCIAL_CONNECTION_ENCRYPTION_KEY` through Vercel, never source control.
- [ ] Specify versioned envelope encryption, server-only decryption, key retirement, and re-encryption tests before provider certification.
- [ ] Register exact production and preview callbacks.
- [ ] Complete Meta and TikTok review with smallest scopes.
- [ ] Request Letterboxd API access only with a bounded profile-link use case.
- [ ] Certify connect, refresh, disconnect, provider denial, expired grant, and deleted upstream account.

## Task 4: User-selected source link intake

**Files:**
- Modify: `lib/wanted.ts`
- Modify: `components/wanted/WantedCapture.tsx`
- Create: `lib/externalSourceLink.ts`
- Create: `__tests__/externalSourceLink.test.ts`

- [ ] Accept user-pasted public URLs as provenance without server fetch.
- [ ] Keep unmatched and ambiguous places private and deletable. Background matching may update match state only.
- [ ] Require venue confirmation and explicit owner promotion before public list visibility.
- [ ] Store provider, source URL, ingest method, consent state, fetched time, and expiry when provider API content is later added.
- [ ] Do not scrape provider pages or import follower graphs.
- [ ] Add tests for unmatched to retry to matched, and for deletion before promotion.
