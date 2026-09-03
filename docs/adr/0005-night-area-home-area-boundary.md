# ADR 0005: Night Area and Home Area are separate concepts

## Status

Accepted

## Decision

A Night Area is a curated, public destination boundary. A Home Area is a private personal start or return anchor. Daypart changes recommendation weighting and guidance; it never changes either area's identity or boundary.

APIs may return Night Area geometry and transport anchors publicly. Home Area must not appear in public Plan or guest-link responses and must not be inferred from a Night Area selection.

## Consequences

- The first release can improve destination recommendations without collecting a home location.
- Get Home guidance requires explicit user input or a separately protected Home Area capability.
- Analytics may record a low-cardinality Night Area slug, never a Home Area value.
