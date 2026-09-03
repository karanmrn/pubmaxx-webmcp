# Pubmaxxing Handoff Seed

Source: `https://github.com/karanmrn/pubmaxxing` at commit `6eafc34`.

This folder preserves the Firecrawl handoff data for all-beverage prices,
pub discovery rows, discount candidates, and history-source seeds. The rows use
the handoff repo's pub ids, so they are not merged directly into the canonical
`pint_prices_app_dataset` yet.

Run `npm run build:pubmaxxing-seed` to regenerate
`public/data/pubmaxxing_seed_snapshot.json`.
