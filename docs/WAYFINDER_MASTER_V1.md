---
title: Wayfinder map - PUBMAXX mobile-web v1
labels:
  - wayfinder:map
  - ready-for-agent
destination: A trustworthy mobile night loop across nine UK cities, with London as the flagship
source: docs/MASTER_PRD.md
---

# Wayfinder: PUBMAXX mobile-web v1

This file is the issue-ready map for `docs/MASTER_PRD.md`. GitHub issues own
execution state; the master PRD owns product meaning and acceptance policy.

## Destination

A person can discover a useful local venue or event, create and share a Plan,
record an arrival, capture a Moment, complete the night, preserve or publish a
recap, and return. London is deepest; the other eight cities degrade honestly.

## Route 0 — Canonical contract and baseline

- [x] Reconcile the master product contract and legacy crosswalk.
- [ ] Record the production mobile baseline and exact release commit.
- [ ] Establish PostHog/Vercel dashboards; the durable PNC query seam is implemented
  in `pnc_qualified_completions`, while provider-side certification remains open.
  The consent and provider checklist lives in `docs/OBSERVABILITY_CERTIFICATION.md`.
- [x] Remove streak telemetry and prove alcohol quantity cannot create progress
  through the closed analytics registry and regression tests.
- [x] Certify risk-tiered rate limits for public writes through the closed 60-route
  CI inventory, production atomic-denial check, and dual-project env verification.

**Gate:** observable failures, valid PNC, no unlimited anonymous writes.

## Route 1 — Mobile map and speed

- [ ] Repair blank/flickering map transitions and repeated camera fits.
- [ ] Make the dark map legible and reduce mobile control density.
- [ ] Fix permission denial, sheets, safe areas, and bottom-nav overlap.
- [ ] Split static ISR CSP from private nonce routes.
- [ ] Ship city-scoped cached payloads, prefetch, drafts, and CI budgets.

**Gate:** 390/430 light-dark matrix, accessibility modes, and performance budgets.

## Route 2 — Nine-city night loop

- [ ] Publish the typed city capability matrix.
- [ ] Complete discover, Plan, invite, arrival, Moment, completion, recap, and return.
- [ ] Enforce qualifying arrival and idempotency in Plan completion.
- [ ] Certify London deep scenarios and honest evidence fallbacks elsewhere.

**Gate:** the complete mobile seam passes in all nine cities.

## Route 3 — Identity, social memory, and return

- [ ] Finish You, owned handles, Pal portrait, and the unified media grid.
- [ ] Add versioned Moment drafts and temporary media persistence.
- [ ] Ship public crawl/recap cards with contributor consent and revocation.
- [ ] Add replies, kudos, friends, collections, quests, mastery, and commitments.
- [ ] Certify the X/Instagram/TikTok provider capability matrix and fallbacks.

**Gate:** measurable share-to-Plan conversion and correct consent withdrawal.

## Route 4 — Pub Pal concierge

- [ ] Certify server-issued ElevenLabs grants, push-to-talk, and typed fallback.
- [ ] Add usage metering and provider privacy configuration checks.
- [ ] Generalise typed proposals and one-use confirmation tokens.
- [ ] Add inspectable memory and Arize trace/evaluation contracts.
- [ ] Test permission, quota, expiry, outage, interruption, and deletion.

**Gate:** Pal failure never blocks the non-character planning journey.

## Route 5 — V1 certification and release

- [ ] Earned PWA prompt; push remains flagged until its own evidence gate.
- [ ] Run full verification, isolated build, mobile visual matrix, and security review.
- [ ] Deploy one pinned commit and verify both production hostnames.
- [ ] Attach screenshots, Web Vitals, provider health, and exact deployment IDs.

**Gate:** owner walkthrough and live commit verification.

## Ticket contract

Every child ticket includes: owner, dependencies, affected routes, public interface
changes, acceptance seam, observability evidence, flag/preview state, failure
fallback, and disable/rollback path. Child tickets link here and to the relevant
master PRD section instead of copying product prose.
