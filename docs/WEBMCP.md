# PUBMAXX WebMCP

## What it does

The Agent Night Board at `/webmcp` gives a person and a browser agent one visible Crawl Route. Both use the same actions. Search and London context stay on an evidence shelf. Draft and swap actions update the ordered Stops and board revision. The final action writes the canonical Plan draft before navigation to `/plan`.

## Why WebMCP fits

Planning a night is collaborative and stateful. A person knows the intent and can judge the result. PUBMAXX owns grounded venue, route, evidence, and handoff rules. WebMCP exposes those narrow product actions to an agent without making it infer controls or scrape page text. The board keeps every result visible, so the person can inspect and change the same object.

## Tools

| Tool | Effect | Trust boundary |
|---|---|---|
| `search_pubmaxx_venues` | Searches the curated venue index | Read-only, bounded to eight results |
| `read_london_night_context` | Reads weather, transport, signals, and opportunities | Read-only, fail-soft, capped untrusted evidence |
| `draft_pub_crawl` | Calls the existing grounded route generator | Requires the board revision the caller inspected |
| `swap_crawl_stop` | Uses the first unused server-provided alternative | Cannot invent a venue; clears old route authority |
| `open_crawl_in_pubmaxx` | Writes the existing V2 Plan draft and opens `/plan` | Refuses absent, malformed, or stale-revision state |

Each tool has a closed JSON Schema and a second runtime validator. The browser schema is discovery metadata, not the only safety boundary. Tool cancellation signals pass to network calls. One registration `AbortController` removes all tools when the page unmounts.

## State and concurrency

The board starts at revision 0. A valid draft or successful swap increments it once. Route mutations run through one client queue. Draft, swap, and open require `expectedRevision`. A queued or pending action cannot publish, write storage, or navigate after the board changes.

A swap can select only an alternative returned with that Stop. It skips venues already used in the route. A successful swap:

- removes the replaced Stop reason;
- clears route totals, confidence, warnings, provenance, grounding proof, and operation key;
- marks the route as needing refresh;
- keeps the exact new Stop order for Plan.

Plan can hydrate this stale route but cannot treat old sequence evidence as current.

## Untrusted London evidence

PUBMAXX server routes proxy CityMCP. The browser projection retains only named fields, caps strings and rows, removes source URLs, and labels the result `untrusted_external_evidence`. External text is evidence only. It cannot invoke another tool, select a venue, or change a route.

## Local test

```sh
npm install
npm run dev
```

Open `http://localhost:3000/webmcp` in ChatGPT's in-app browser. No environment variables are required.

Focused checks:

```sh
npx vitest run __tests__/webmcpRegistration.test.tsx __tests__/webmcpBoard.test.ts __tests__/webmcpPage.test.ts
npx eslint app/webmcp/page.tsx components/webmcp/WebMcpNightBoard.tsx lib/webmcp e2e/webmcp-night-board.spec.ts
npx playwright test e2e/webmcp-night-board.spec.ts --project=chromium
```

The Playwright test installs a browser-local WebMCP harness to prove the page contract. It does not replace final native discovery proof in ChatGPT's in-app browser.

## Compatible browsers

- ChatGPT in-app browser: supported without setup.
- Google Chrome 149 or later: enable `chrome://flags/#enable-webmcp-testing`, then restart Chrome.

Open `/webmcp`, confirm `Agent tools ready`, and ask the browser agent to list available tools. Test context, draft, swap, and Plan handoff. A normal browser shows `Manual board ready`; direct controls remain functional.

## Main implementation files

- `lib/webmcp/modelContext.ts`: names, schemas, runtime input validation, annotations, and registration lifecycle.
- `lib/webmcp/board.ts`: route validation, evidence slots, revisions, safe swaps, mutation queue, and Plan draft write.
- `components/webmcp/WebMcpNightBoard.tsx`: shared actions, same-origin API calls, visible board, and manual parity.
- `app/webmcp/page.tsx`: dedicated top-level route.
