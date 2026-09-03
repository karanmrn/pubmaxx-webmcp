# PUBMAXXING — Security & Reliability PRD

**Version:** 2026-07-07  
**Focus:** Prevent the site from being hacked or going down.  
**Audience:** Fable, Opus, sub-agents, and any engineer touching production.

---

## 1. Executive Summary

PUBMAXXING handles user-generated content (photos, Spills, messages, ratings), real money-adjacent signals (pint prices), heritage data, and real-time social features. A single successful attack or outage can destroy trust — the product’s most valuable asset.

This PRD defines the minimum security and reliability posture required before public launch.

---

## 2. Threat Model

**Assets to protect:**
- User identity & private messages
- User-generated photos & voice notes
- Price data that influences real-world behavior
- Heritage / provenance claims (trust signal)
- Admin moderation capabilities
- LLM spend (OpenRouter)

**Primary Attack Vectors:**
1. **Abuse & Spam** — Mass fake Spills, ratings, messages, presence.
2. **Injection** — XSS via rich text or photo metadata, SQLi via any query.
3. **Authorization Bypass** — Acting as another user, escalating to admin, viewing private messages/Spills.
4. **Data Exfiltration** — Leaking private photos, messages, or full user lists.
5. **Resource Exhaustion** — LLM cost attacks, storage abuse, rate-limit bypass.
6. **Supply Chain** — Compromised dependency, malicious migration, Vercel/Supabase breach.
7. **Operational Failure** — Bad deployment, Supabase outage, OpenRouter key leak, missing RLS.

---

## 3. Current Security Posture (Post 2026-07-07 Pull)

**Already Good:**
- Consistent dual-store seam with graceful degradation.
- Actor-scoped rate limiting on many write paths (`pint-drops`, `comments`, `reactions`, `saved-pubs`).
- RLS policies on core tables (profiles, follows, saved_pubs, visit_reports, etc.).
- Admin token-gated moderation route.
- CSP headers and realtime publication controls (recent migrations).
- No-store on social responses (latest commit).
- Optimistic UI reduces some attack surface by not requiring immediate server round-trips.

**Known Gaps (High Risk):**
- No EXIF stripping or magic-byte validation on photo uploads (still required).
- Private Storage bucket + signed URLs not yet enforced for hidden content.
- Rate limiting is per-IP or per-handle in many places — easy to bypass with many devices or rotating handles.
- No structured logging or error boundaries on API routes.
- Admin token is stored in localStorage with no rotation or scoping.
- No automated secret scanning or dependency vulnerability checks in CI.
- Realtime (messages, presence) has limited abuse controls.
- Drink price refresh script and Wetherspoons scraper run with broad permissions.
- No incident response runbook or rollback procedure documented.

---

## 4. Required Security Controls

### 4.1 Authentication & Authorization

- Enforce Supabase Auth (Magic Links) before any durable social action (Spills, messages, ratings, saved lists).
- RLS policies must be **deny-by-default**. Every new table must have explicit policies.
- Actor identity must be validated server-side on every write (never trust `handle` from client only).
- Admin actions must require a short-lived, scoped JWT or service-role token, never a static localStorage token.

### 4.2 Input Validation & Content Safety

- **Photo uploads**:
  - Magic-byte validation (not just MIME type).
  - EXIF stripping (use `sharp` or similar on the server).
  - Max dimensions + compression.
  - Private bucket + signed URLs for any non-public content.
- **Text / Voice**:
  - Sanitize all rich text (use `dompurify` or equivalent).
  - Length limits + profanity / spam heuristics on Spills, messages, ratings.
- **Ratings & Reviews**:
  - One rating per user per venue per time window (prevent review bombing).
  - Detect coordinated attacks via velocity + graph analysis.

### 4.3 Rate Limiting & Abuse Prevention (Hardened)

Current per-IP / per-handle limits are insufficient.

**Required upgrades:**
- Per-actor (Supabase `user_id` or strong device fingerprint) + per-IP composite keys.
- Sliding window + exponential backoff.
- Behavioral signals: rapid creation of new handles, unusual geo patterns, high volume from single ASN.
- CAPTCHA or proof-of-humanity on high-risk actions after threshold.
- Hard global caps on Spills per hour/day per actor.

### 4.4 Data Protection & Privacy

- All private media must live in a private Storage bucket with signed URLs (never public).
- Messages must be encrypted at rest or use Supabase Vault / row-level encryption.
- PII (email, phone if collected) must be minimized and never returned in public APIs.
- Audit log for all admin and moderation actions (who viewed/hid what and when).

### 4.5 Infrastructure & Secrets

- All secrets (Supabase service key, OpenRouter key, admin tokens) must be in Vercel Environment Variables or Supabase Vault — never in code or localStorage.
- Rotate OpenRouter key on a schedule; monitor spend with alerts.
- Enable Supabase Point-in-Time Recovery and daily backups.
- Vercel preview deployments must not have access to production Supabase.
- Dependency scanning (Dependabot or `npm audit`) must fail CI on high/critical vulns.

### 4.6 Observability & Incident Response

- Structured logging (JSON) on every API route with request ID, actor, action, latency.
- Error boundaries + Sentry (or Vercel Analytics + logging) on both client and server.
- Real-time alerts for:
  - Spike in 4xx/5xx errors
  - LLM spend > threshold
  - New admin actions
  - Rate-limit exhaustion from single actor
- Documented rollback procedure: “git revert + Vercel redeploy” or Supabase migration revert.
- Quarterly security review + penetration test before major launches.

---

## 5. Phased Implementation (Security-First)

**Phase 1 (Before any public social launch)**
- EXIF stripping + magic-byte validation on all uploads.
- Private Storage bucket + signed URLs for hidden Spills.
- Enforce Supabase Auth on all durable writes.
- Harden rate limiting with composite actor+IP keys.
- Add structured logging + error boundaries on all API routes.
- Remove static admin token from localStorage; replace with scoped, short-lived token.

**Phase 2 (Before ratings & messaging go live)**
- One-rating-per-user-per-venue rate limit + anomaly detection.
- Message encryption at rest or Vault.
- CAPTCHA on high-velocity actions.
- Dependency scanning + secret scanning in CI.

**Phase 3 (Ongoing)**
- Quarterly penetration test.
- Automated backup + restore drills.
- Public bug bounty or responsible disclosure program.
- Security.txt and clear incident response contact.

---

## 6. Testing & Verification

- Every new table or API route must include a test that proves RLS denies unauthorized access.
- Load tests for rate limiting and realtime abuse scenarios.
- Chaos engineering: kill Supabase connection, OpenRouter key, or Vercel deployment mid-flow and verify graceful degradation.
- Regular `npm audit` + Dependabot PRs must be reviewed within 48 hours for critical issues.

---

## 7. Success Criteria

- Zero unauthenticated writes to any durable table.
- Zero public Storage URLs for private media.
- Rate limiting cannot be bypassed by rotating handles or IPs within normal abuse thresholds.
- Admin actions are fully audited and require fresh authentication.
- Mean time to detect (MTTD) security incident < 15 minutes via alerts.
- Mean time to recover (MTTR) from deployment or Supabase issue < 30 minutes via documented rollback.

---

## 8. Out of Scope (This PRD)

- Physical security of team devices
- Legal / compliance (GDPR, data residency) — separate track
- Supply-chain attacks on Vercel or Supabase themselves (accept as platform risk)

---

**This PRD must be treated as non-negotiable before any public launch of social, ratings, or messaging features.**

Security is not a feature — it is the foundation that allows users to love and trust the product.

---

*End of Security & Reliability PRD.*