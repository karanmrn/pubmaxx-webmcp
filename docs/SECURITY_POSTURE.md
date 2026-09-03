# Security Posture Register

Register of ACCEPTED risks and FIXED-this-wave security hardening (wave S1–S5, 2026-07-07 onwards). Future audits should reference this document to avoid re-flagging accepted trade-offs.

## Accepted Risks

### Image Proxy DNS-Rebinding Residual

**Risk:** The image proxy serves pre-vetted pub-site images via a hostname allowlist (~160 pre-vetted pub-site hosts bundled from datasets: Wetherspoon, Greene King, JD Wetherspoon, etc.). Allowlist is NOT backed by DNS-resolution IP pinning. A malicious actor controlling the DNS for a whitelisted host could rebind its IP to an internal service (e.g., 127.0.0.1, 169.254.169.254).

**Blast Radius:** Images served from that host only. Confined to public image URLs already in the allowlist; no new hosts can be added via user input.

**Mitigation:** Allowlist is curated, fixed-cardinality, and sourced from reliable venue datasets (scraped chain pub data). Runtime: `lib/imageProxy.ts` validates `hostname_in` against the allowlist before fetching. Requests for non-whitelisted hosts are rejected at proxy entry.

**Decision:** Accepted. Future: IP pinning possible via DNS-over-HTTPS + local cache, but adds complexity for marginal risk reduction (attacker already controls one host's DNS).

---

### Presence Spoofing (Opt-in Tap, No GPS)

**Risk:** "I'm here" presence signal is an opt-in tap by the user, NOT GPS-backed. A user can claim presence at any venue without proof of location.

**Accepted Rationale:** Presence is BY DESIGN a social signal for discovery ("who's out now"), not a strict location service. Spoofing presence at a false venue is low-value attack:
- Community reputation (followers, Pint Passport badges) already requires authentic drops/activity history
- Venue staff and regulars will quickly spot fake "I'm here" taps
- No admin role or moderation capability is granted by presence alone
- Rate limiting caps abuse (see FIXED-this-wave)

**Decision:** Accepted. Presence verification via GPS would break the lightweight opt-in UX and add privacy/battery concerns.

---

### Code-is-Capability: Round Codes + Legacy Unlinked Handles

**Risk:** Round creation/share codes (6-char human-readable or 28-symbol
URL-safe alphanumeric) remain the Round trust boundary. Anyone with a round
code can join that group and record itemised diary lines, but only a verified
account with a claimed handle can promote its own lines to community prices. An
unowned handle retains only existing demo paths; it can never become account
authority or authorize current community price or venue-signal writes.

**Backstopped By:**
- Rate limits on round creation (S1–S3 phase): plan-card, citymcp+whats-on, rounds-GET, import-notes each have per-IP/per-actor limits
- Capacity cap on Landlord LLM (durable Supabase limiter: prevents unpaid concierge from unbounded token burn)
- JWT-backed authorship gates for destructive actions (edit/delete crawls, modify profiles) — see `gateHandleAction` in `app/api/crawls/[slug]/route.ts`
- Atomic `claim_pubmaxx_handle` creates only absent handles with `user_id`
  already set. Every existing profile is taken, and unique constraints plus
  advisory locking prevent handle land-grab races.
- A Round code carries diary-write capability, not community-price identity. Itemised lines reach the community price store only for a verified account with a claimed public handle, then charge that stable profile actor's account budget. Anonymous lines stay in the Round diary. Each line persists its promotion state so failed writes can retry without claiming success. Map authority remains behind corroboration and max-age gates - boundary certified in `docs/WRITE_SURFACE_CERTIFICATION.md`

**Decision:** Accepted for foundation-first staging. Direct community price and
venue-signal writes now require Supabase Auth and an account-owned handle.
Round codes remain human-manageable capabilities for small-group coordination;
Visit Reports and Recommendations remain explicit identity follow-up. The
rate-limiting backstop prevents casual abuse on the remaining device-scoped
paths.

---

### CSP `style-src 'unsafe-inline'`

**Risk:** Content-Security-Policy allows `style-src 'unsafe-inline'`. This is required because MapLibre GL injects inline styles at runtime (canvas controls, marker positioning). An XSS vulnerability could inject arbitrary CSS.

**Rationale:** MapLibre is a core dependency for the 3D map feature. No practical way to inline-hash all dynamically positioned styles without major refactor. Inline styles are namespace-scoped to map controls and do not expose sensitive data.

**Mitigation:** Script nonce on RSC streams prevents script-injection XSS (S4 phase, added in this wave). Style injection alone cannot access user data, craft auth tokens, or modify the page structure in ways that exfiltrate secrets.

**Decision:** Accepted. Revisit if/when MapLibre supports external stylesheets for dynamic values.

---

### No CORP / COEP Headers

**Risk:** Cross-Origin-Resource-Policy (CORP) and Cross-Origin-Embedder-Policy (COEP) are NOT set. Hostile cross-origin sites can embed map tiles and venue imagery from pubmaxxing.com.

**Rationale:** Map tiles (from OpenFreeMap, CARTO) are already public and meant to be embeddable. Venue photos are sourced from public URLs (Wikimedia Commons, S3 public buckets). Setting CORP: `cross-origin` or COEP would not meaningfully restrict access to already-public content, and would break tile embedding in embedded-map use cases (future feature).

**Decision:** Accepted. Tile + image embeddability is a feature, not a bug.

---

## Fixed This Wave

### S1–S3: Rate Limiters on Core Endpoints

**Fixed:**
- **Plan-card limiter:** Per-IP rate limit on `/api/rounds` create (prevents burst round spam)
- **CityMCP+whats-on limiter:** Per-IP rate limit on `/api/citymcp/*` endpoints (prevents unthrottled Landlord LLM usage)
- **Rounds-GET limiter:** Per-IP rate limit on round join/list (prevents enumeration attacks)
- **Import-notes limiter:** Per-actor rate limit on `/api/pint-drops/import-notes` (prevents bulk comment injection)

**PR Reference:** S1–S3 wave consolidated in commits `6691a27` (durable Supabase rate limiting), `0ff095a` (image proxy rate limit 120/min), and prior hardening merges via #52 / #67.

**Verification:** `lib/rateLimiter.ts` uses Supabase durable limiters when `RATE_LIMIT_SALT` is configured (production). Fallback: in-memory limiters are documented to fail open across serverless instances (acceptable for MVP, production must configure Supabase).

---

### S4: CSP Script Nonce

**Fixed:** Arbitrary inline scripts without the per-request nonce are blocked.
`proxy.ts` places the nonce in the request and response CSP, and Next.js stamps
the matching value onto its inline hydration scripts.

**Impact:** `script-src` no longer includes `'unsafe-inline'`. The nonce keeps
HTML dynamic; the [CSP and caching decision brief](evidence/csp-vs-caching.md)
owns alternatives and their security consequences.

---

### S5: HSTS Preload + Security Posture Register + Migration Ledger

**Fixed (This PR):**
- **HSTS preload:** Strict-Transport-Security header now includes `preload` directive, registering pubmaxxing.com for HSTS preload list (browsers enforce HTTPS-only from first load)
- **Migration ledger notes:** Documented duplicate migrations (0013, 0014, 0015) — each applied twice to production, files include re-application headers, bodies are idempotent
- **Security posture register:** This document, consolidating accepted risks and fixed items for future audit clarity

---

## Audit Trail

- **Full findings:** [docs/AUDIT_FINDINGS_2026-07-07.md](./AUDIT_FINDINGS_2026-07-07.md)
- **Hardening phases 0–6:** Detailed status in audit document § "Security hardening plan coverage"
- **Wave layout:** S1–S5 rolling security + feature hardening; concurrent features (whats-on, journey legs, etc.) in separate feature lanes (A, B)

---

## Migration Ledger Notes

### Duplicate Migration Pairs

Supabase remote ledger recorded three migrations twice due to CLI/MCP re-run on 2026-07-07. Local migration directory contains both versions. **Canonical (earlier) versions should be retained; re-application versions are for preview-branch GitHub integration only.**

#### 0013: comment_replies (Threaded replies on Pint Drop comments)

- **Canonical:** `20260707010745_0013_comment_replies.sql`
- **Re-application:** `20260707053307_0013_comment_replies.sql` (has re-application header)
- **Contents differ:** NO (re-application version only adds explanatory comment header)
- **Body idempotent:** YES (`add column if not exists`, `create index if not exists`)
- **Recommendation:** Retain canonical version (earlier timestamp). Re-application version exists only to satisfy GitHub preview-branch integration. If ledger is collapsed in Supabase remote, this file can be deleted.

#### 0014: realtime_publication (Supabase Realtime row-level broadcasts)

- **Canonical:** `20260707010750_0014_realtime_publication.sql`
- **Re-application:** `20260707053327_0014_realtime_publication.sql` (has re-application header)
- **Contents differ:** NO (re-application version only adds explanatory comment header)
- **Body idempotent:** YES (`do $$ ... if not exists ... $$`)
- **Recommendation:** Retain canonical version. Re-application version is for preview-branch integration only.

#### 0015: index_cleanup (Drop and recreate indexes for performance)

- **Canonical:** `20260707010941_0015_index_cleanup.sql`
- **Re-application:** `20260707053355_0015_index_cleanup.sql` (has re-application header)
- **Contents differ:** NO (re-application version only adds explanatory comment header)
- **Body idempotent:** YES (`do $$ ... drop ... $$`, `create index if not exists`)
- **Recommendation:** Retain canonical version. Re-application version is for preview-branch integration only.

**Note:** See `docs/RUNBOOK_SUPABASE_PREVIEW.md` for full ledger-collapse procedure if re-applications are removed from remote.
