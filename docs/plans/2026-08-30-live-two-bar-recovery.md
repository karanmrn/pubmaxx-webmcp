# Live two-bar recovery

Date: 30 August 2026

## Goal

Close only the two failed production bars from the 30 August live review:

1. A signed-in drinker submits one real Pint Drop and the public feed returns it.
2. Tonight shows confirmed pub listings, or an honest empty that does not claim quiz, sport, deals, music, or events exist.

## Scope

- Keep the existing signed-in Pint Drop write path. Do not add sample rows, seed data, a second authentication system, or a new table.
- Make Tonight category copy depend on the categories in the current rendered listing inventory.
- Keep cross-referenced `derived` rows out of confirmed category copy.
- Offer the map only when a rendered row has a usable map link.
- Keep an empty or failed Tonight read free of category claims.
- Keep quiet-pint recommendations separate from confirmed Tonight listings.
- Use focused unit tests and targeted lint only while the machine resource hold is active.
- Use the Codex in-app browser only for later interactive production proof.

## Work

### 1. Tonight claim honesty

- Add a failing test for the empty Tonight surface.
- Add one canonical helper that derives the listing line from rendered row kinds.
- Render no listing-category line for empty, failed, or loading states.
- Prove populated states name only categories that exist.

### 2. Pint Drop production proof

- Confirm the deployed route uses the durable production store.
- After an authorised signed-in drinker submits a real observed pint, verify the POST receipt and public GET row.
- Record venue, category, price, author attribution, timestamps, deployment id, and response status.
- Never invent a drink, identity, price, or submission.

### 3. Release checkpoint

- Integrate only after focused review and hosted checks can run.
- Deploy the accepted commit once.
- Re-check the two bars on `https://pubmaxxing.com` with the Codex in-app browser.
- Keep all other GrokBot findings outside this cut.
