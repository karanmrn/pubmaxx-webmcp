# Findings Confidence Ledger V4 - 2026-08-06 (issue-queue audit)

Supersedes the open-ledger section of `FINDINGS_CONFIDENCE_V3_2026-07-19.md`.
Verified at HEAD `2883e7bf` by a dedicated audit agent; every verdict was re-run
against the tree, not carried on trust. Full per-issue evidence lives in the
session record; this file is the durable summary.

## Verdict counts (23 open issues)

- RESOLVED-ON-MAIN and closed with evidence: #635 (PR #638), #441 (PR #455)
- STALE/SUPERSEDED and closed: #168 (superseded by #727)
- STILL-REAL, dispatchable: #727 (store-factory pilot), #443 (wrapped-build
  Gate Z evidence), #392 (soft-launch runbook)
- OWNER-GATED: #390 (store enrollment), #385 (Ticketmaster key)
- TRACKING: the Social programme #728-#736 (children: #729 ~95% on main,
  #730 ~95% on main via #756/#757, #731/#732 riding open PR #743, #733 riding
  #744, #734 riding #745/#746 with the rework spec pending, #735 and #736
  unstarted - #736 partly owner-gated on naming the moderation rota), plus
  #437 (~85%), #384 (~90%), #287/#282 (parked by design), #252 (~40%).

## Closed-issue integrity

15 user-facing closed issues spot-checked at HEAD: zero reopen candidates.
Notably #279's closure is sound - freshness single-sourcing was built through
`data/freshness_registry.json` rather than the `*.meta.json` sidecars V3
doubted.

## V3 open-ledger movement

Cleared (8): DeliveryStatus union (lib/deliveryStatus.ts), DAY_MS
(lib/dayMs.ts), the three brass-token files (zero raw `--brass` refs),
share-helper duplication (RecapShareButton imports lib/shareArtifacts),
issue #417 point-row grace (lib/whatsOn.ts POINT_ROW_GRACE_MS),
price-confirm cert row (WRITE_SURFACE_CERTIFICATION.md:476). Mostly via
PR #754.
Half-cleared (1): EXA ops half live (key present in Vercel; night-signals
route never publishes unreviewed rows); product half stays owner-gated.
Unchanged (3): write-path newline (owner), map-gl e2e (owner),
APNS key half of push (web-push halves shipped).
Worse (1): remote branch count grew 158 -> 293; prune still owner-gated,
`git cherry` verification required before any deletion.

Residual follow-up filed: DAY_MS literals outside the V3-named files
(lib/a2hsPrompt.ts:25, lib/dailyActivity.ts:9, lib/priceConfirmStore.ts:84).
Write-surface certification grew 63 -> 77 surfaces.

## Net

Confidence up: 8 of 13 ledger rows cleared, closed-issue integrity clean,
three dead issues closed. The queue now states real work only: three
dispatchable fixes, two owner gates, and the tracked Social train.
