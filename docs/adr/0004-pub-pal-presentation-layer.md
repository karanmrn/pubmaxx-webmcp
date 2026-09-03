# ADR 0004: Pub Pal is an optional presentation layer

## Status

Superseded by ADR 0006

## Decision

All Pub Pals use the same recommendation, factual-grounding, price, and safety engine. A selected Pub Pal may change visual identity, tone, explanations, prompts, and optional narration. It must not secretly alter route ranking. Core planning remains complete when Pub Pal is muted, hidden, or disabled.

Pub Pal memory is stored as inspectable structured preferences and outcomes with provenance. Generated character prose is never source-of-truth memory, and inferred sensitive preferences require confirmation before persistence.

## Consequences

- Character selection cannot weaken route quality or make recommendations unpredictable.
- Pub Pal can ship after first route value without blocking anonymous activation.
- Every future character surface must preserve a non-character equivalent.
