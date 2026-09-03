# CityMCP London integration

**Endpoint:** `https://citymcp.com/london/mcp` (Streamable HTTP / SSE, keyless)
**Transport:** POST JSON-RPC, `Accept: application/json, text/event-stream`
**Tools:** `search_places`, `get_place`, `get_area`, `get_journey`, `city_status`, `things_to_do`

CityMCP London is our authoritative source for London-local, "right now"
facts: weather, TfL disruptions, event/protest/strike signals, and thin
Google-Places venue rows for name-based lookups. It's Server-Sent-Events
under the hood, and every response is a single JSON-RPC envelope on one
`event: message` frame — see `parseSseJsonRpcBody` in `lib/citymcp/client.ts`.

## Cursor MCP reload

The MCP config lives at `.cursor/mcp.json` (project-scoped, committed; other
`.cursor/*` files stay gitignored):

```json
{
  "mcpServers": {
    "citymcp-london": { "url": "https://citymcp.com/london/mcp" }
  }
}
```

To pick up config changes in Cursor Desktop:

1. **Command Palette** (`Cmd/Ctrl+Shift+P`) → **Developer: Reload Window**  
   (or Settings → **Tools & MCP** → refresh / toggle `citymcp-london` off→on).
2. Open **Settings → Tools & MCP** and confirm `citymcp-london` shows as
   connected (green / tools listed).
3. You should see tools: `city_status`, `search_places`, `get_place`,
   `get_area`, `get_journey`, `things_to_do`.
4. Smoke in Agent chat: *“Call city_status on CityMCP London and summarize
   Tube disruptions.”*
5. If it fails: check the URL is exactly `https://citymcp.com/london/mcp`
   and that your network can reach `citymcp.com` (no API key required).

## Runtime API surfaces (app-facing)

The app never calls CityMCP from the browser directly; it goes through
server-only routes so the SSE handshake stays on Node and no secrets/UA rules
leak into the client.

- **`lib/citymcp/client.ts`** — server-only MCP client. Public helpers:
  - `callCityMcpTool(name, args, opts?)` — generic `tools/call` with typed
    JSON-RPC error handling (`CityMcpError`).
  - `fetchCityStatus({ borough? }, opts?)` — cached (~5 min in-process) wrapper
    around `city_status`. Cache is per-borough; use `resetCityStatusCache()`
    in tests.
  - `searchCityPlaces(query, opts?)` — `search_places` with optional `limit`,
    `near`, `openNow`, `minRating`, `maxPrice`, `sort`.
  - `fetchCityPlace(id, { deep? })` — cached (~10 min in-process) wrapper
    around `get_place`. Result is always a `CityPlace` — trimmed via
    `trimCityPlace` to a documented whitelist (identity, hygiene, transit,
    air, weather). Cache key is `(id, deep)`; use `resetCityPlaceCache()`
    in tests.
  - `fetchThingsToDo({ window, area?, kinds?, price?, limit? })` — cached
    (~5 min) wrapper around `things_to_do`. `window` must be one of
    `tonight | tomorrow_night | this_weekend`. The trimmed opportunity contract
    lives in `lib/citymcp/client.ts`; it preserves a firm upstream `startsAt`
    and human-readable `timeEvidence` independently, without inferring one from
    the requested window. Use `resetThingsToDoCache()` in tests.
- **`GET /api/citymcp/status`** — returns `{ asOf, weather?, tubeLines?, signals[] }`
  trimmed for UI: tube "Good Service" lines are dropped, and signals are capped
  to the top 6 by severity (major > notable > info). Always fail-soft: any
  upstream failure returns 200 with `{ error, signals: [] }`.
- **`GET /api/citymcp/places?q=...&limit=5`** — thin place rows for
  `search_places`. Validates `q` (non-empty, ≤ 200 chars) and returns 400
  otherwise; upstream failures fail-soft to 200 with `{ places: [], error }`.
- **`GET /api/citymcp/place?id=...&deep=0|1`** — one trimmed place dossier
  via `get_place`. `id` must be non-empty (≤ 200 chars) else 400; upstream
  failures return 200 with `{ place: null, error }`. `deep=1` requests the
  full enrichment join (hygiene / transit / air / weather); default is
  identity-core only. We NEVER invent hygiene scores or ratings — every
  field surfaces only when the upstream provided it, and only fields on the
  `CityPlace` whitelist are returned.
- **`GET /api/citymcp/things-to-do?window=tonight|tomorrow_night|this_weekend&area=&kinds=a,b&price=any|cheap|free&limit=`**
  — curated `things_to_do` opportunities for a plan window. `window` is
  validated (defaults to `tonight`); unknown `kinds` / `price` are dropped
  silently so the lane always renders when possible. `limit` is capped at
  20 (default 6). Upstream failures fail-soft to 200 with
  `{ opportunities: [], error }`.
- **`components/map/CityStatusBanner.tsx`** — the London-only strip that
  fetches `/api/citymcp/status` on mount and shows one compact headline
  (top signal → tube summary → weather). Only renders when `cityId === "london"`.
- **`components/map/CityPlaceStrip.tsx`** — a compact "Around now" dossier
  strip in the venue-sheet Overview (rating, open-now, hygiene-if-present,
  transit snippet). London-only. Matches the venue via `search_places` by
  name + area then confirms with a haversine coordinate check (≤ 250 m)
  before calling `get_place`; hides entirely if no confident match, or on
  any upstream error. Uses a generation-token pattern so rapid sheet
  switches never race a stale dossier onto a newly-selected venue.
- **`components/discovery/TonightNearbyLane.tsx`** — Discover "Tonight
  nearby" lane that reads `/api/citymcp/things-to-do?window=tonight`. Cards
  deep-link into the London map when the upstream attached coordinates +
  place id, else the source URL, else no CTA. Hides the section when the
  upstream returns no opportunities or errors.

## What NOT to rebuild

- **Last-train / "last pint" decisions:** we already own this at
  `GET /api/last-train` (TfL Unified API, live Arrivals + timetable fallback,
  disruption summary, nearest-station geo). CityMCP `get_journey` and
  `city_status.tubeLines` are complementary; do not use them to replace the
  TfL-native last-train pipeline.
- **Static venue index / prices / hygiene badges:** the PubMaxing dataset in
  `data/` and `lib/venuePriceIndex.ts` remains the source of truth for names,
  cheapest price bands, and curated crawls. Use `get_place` (`deep: true`)
  only for opt-in enrichment on specific venues — do not fabricate hygiene
  scores or Order URLs in the UI.
- **City chooser / nearestCity / preferred city:** those are entirely local
  logic (`lib/cities.ts`, `lib/nearestCity.ts`), unrelated to CityMCP.

## Upstream quirks

- The server returns `text/event-stream` for `initialize`, `tools/list`, and
  `tools/call`, and `202` (no body) for `notifications/initialized`. We only
  send `tools/call` — no explicit `initialize` handshake — which the server
  accepts fine per the probe run.
- No `mcp-session-id` header is emitted on any response, so subsequent calls
  do not need to echo one back.
- `tubeLines[].status` values seen so far: `Good Service`, `Minor Delays`,
  `Part Closure`, `Planned Closure`. `disruption` is a free-form string, often
  multi-sentence — the UI truncates to a single line.
- `signals[].severity` values seen: `info`, `notable`, `major`. Anything else
  should be treated as lowest priority (`trimSignals` handles this).

## Local smoke-test

```bash
# Status
curl -s http://localhost:3000/api/citymcp/status | jq .

# Search places
curl -s "http://localhost:3000/api/citymcp/places?q=The%20George%20Southwark&limit=3" | jq .

# One place dossier (deep enrichment)
curl -s "http://localhost:3000/api/citymcp/place?id=<PLACE_ID>&deep=1" | jq .

# Things to do tonight (also: tomorrow_night, this_weekend)
curl -s "http://localhost:3000/api/citymcp/things-to-do?window=tonight&limit=6" | jq .
curl -s "http://localhost:3000/api/citymcp/things-to-do?window=this_weekend&area=Shoreditch&kinds=gig,comedy&price=cheap" | jq .
```

Then open the London map (`/map` with London selected) and confirm the status
strip renders below the toolbar. On upstream failure the strip should stay
hidden — never a red error state.

## Related tests

- `__tests__/citymcpClient.test.ts` — SSE parser, `trimSignals`, generic
  `tools/call` behaviour, city_status cache, `search_places` filters,
  `trimCityPlace` whitelist, `fetchCityPlace` cache, `fetchThingsToDo`
  trim + cache + invalid-window guard.
- `__tests__/citymcpStatusRoute.test.ts` — status route validation,
  trimming, fail-soft.
- `__tests__/citymcpPlacesRoute.test.ts` — places route validation,
  thin-row shape, fail-soft.
- `__tests__/citymcpPlaceRoute.test.ts` — place-dossier route validation,
  whitelist trimming, `deep=1` forwarding, fail-soft.
- `__tests__/citymcpThingsToDoRoute.test.ts` — window enum, kinds/price
  filtering, default window, limit cap, fail-soft.
