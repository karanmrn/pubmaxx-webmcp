# Slice 01: Grounded free-text constraints

## Contract

A free-text ask that explicitly requests supported access, a numeric budget
ceiling, or transport constraints must never bypass checked evidence. Tonight
Agent must use the same completed-intake request seam as Plan's describe-first
entry.

## API Seam

- Extend `selectPlanGenerationCandidates` and
  `selectAnchoredPlanGenerationCandidates` to resolve supported access needs
  from authoritative intake when answered, otherwise from reconciled Night
  Context.
- Add `buildTonightAgentGenerateBody(query)` in `lib/tonightAgent.ts`. It
  returns `{ query, intake }` using the existing skip-all Plan intake handoff.
- `components/plan/TonightAgentPanel.tsx` sends that body.

## Verification

- `__tests__/planRouteConstraints.test.ts`: context-derived `step-free` is a
  hard constraint when intake accessibility was skipped.
- `__tests__/planRouteConstraints.test.ts`: no-intake access, numeric budget,
  and transport constraints enter grounding and fail closed when evidence is
  unavailable. A soft value preference without a numeric ceiling keeps the
  legacy path.
- `__tests__/tonightAgent.test.ts`: request builder includes a valid completed
  intake and trimmed query.

Keep every existing Plan generation and Tonight Agent test green.
