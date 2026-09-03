# Pub Pal setup: text now, voice when you switch it on

Pub Pal answers in writing with no keys at all. Voice is one optional add-on
the captain switches on with four environment values and one script run.

Nothing here changes what the Pal may SAY. Text and voice run the same
source-backed tool registry (ADR 0014) and the same propose-then-confirm rule
(ADR 0006).

---

## What works with no keys

| Surface | Keyless | Notes |
|---|---|---|
| `/pal/chat` text ask | Yes | Deterministic router picks one or two tools and answers from our own rows |
| Map Ask | Yes | Same `/api/ask` path |
| Concierge tools (prices, tonight, drinks, desk, crowd) | Yes | Every one of them reads a lane we already hold |
| Model tool selection | No | Needs `OPENROUTER_API_KEY`; without it the deterministic router chooses the tools |
| Reader wording | Yes | House output comes from returned rows and hints; the model does not write the answer |
| Voice | No | Needs the four ElevenLabs values below |

With voice off, `/pal` says so in the Pal's own words and offers the writing
door. It never shows a Start button that would fail on the tap.

---

## The four values

Put these on the deployment (Vercel: Project → Settings → Environment
Variables → Production, Preview). All four are server-only.

| Key | What it is |
|---|---|
| `ELEVENLABS_API_KEY` | Account key. Never reaches the browser: `/api/pub-pal/voice-token` mints a short-lived signed session URL instead |
| `ELEVENLABS_PUB_PAL_AGENT_ID` | The agent the script below creates |
| `ELEVENLABS_LLM_SHARED_SECRET` | The secret ElevenLabs presents to `/api/pub-pal/llm`. Generate with `openssl rand -hex 32` |
| `ELEVENLABS_VOICE_EMBER` / `_VELVET` / `_SIGNAL` | The three curated voice ids. Optional per slot: an unset slot falls back to the agent default |

`.env.example` carries the same names with empty values.

---

## Creating the agent

```bash
# Local dry run: prints what would be written, holds the shared secret back,
# and calls nothing.
npm run pubpal:agent -- --dry-run --base-url https://pubmaxxing.com

# Real run: creates the agent, or updates the one already there.
npm run pubpal:agent -- --base-url https://pubmaxxing.com
```

The script reads `.env.local` and `.env`, so a local run needs no exported
shell variables. A dry run still needs `ELEVENLABS_LLM_SHARED_SECRET`, because
it prints the agent it would write and that body carries the secret; it does
not need `ELEVENLABS_API_KEY`, because it calls nothing. `--base-url` also
reads `PUBMAX_BASE_URL`, and it must be https (or `http://localhost` for a
tunnel test). It is idempotent: with `ELEVENLABS_PUB_PAL_AGENT_ID` set it
patches that agent, and without one it looks for an agent named
`PUBMAXX Pub Pal` before creating a new one. Re-running never leaves two.

It sets four things and nothing else:

1. **Custom LLM** pointed at `<base-url>/api/pub-pal/llm`, with the shared
   secret. That route runs the same source-backed Night OS Ask path the text
   surface runs, so the voice cannot answer from the provider's own model.
2. **Zero retention**: no audio recording, no transcript, no PII kept. ADR 0006
   is explicit that raw audio and transcripts are never memory.
3. **The three voices**, when their ids are set. The agent-level voice is the
   default; each session then overrides it with the caller's own Pal voice from
   `lib/palVoiceOverrides.ts`, so ember, velvet and signal all sound right off
   one agent.
4. **The house prompt**: speak what the tools return, never invent a price or
   an hour, propose but never apply, and switch to plain speech on get-home
   topics.

On a first create the script prints the agent id. Put it on the deployment as
`ELEVENLABS_PUB_PAL_AGENT_ID` and redeploy.

---

## Checking it

```bash
# Answers available, maxSessionSeconds, retention and mutationPolicy.
# `available` turns true once `ELEVENLABS_API_KEY` and the agent id are set.
curl -s https://pubmaxxing.com/api/pub-pal/voice-token | jq .

# Should answer 401 without the shared secret, never 200.
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://pubmaxxing.com/api/pub-pal/llm \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"cheapest pint in Camden"}]}'
```

Then open `/pal`, create a Pal, and press Start voice chat. The status line
reads "Pal is listening" once the socket is up.

On the first tap, the browser asks for microphone access before the server
issues a metered voice grant. A denied request keeps the writing door open and
can be retried. Repeated taps while voice starts use the same attempt.

`GET /api/pub-pal/voice-token` answers one boolean about this deployment's own
configuration and reads no account, which is the whole reason the Pal can
explain itself before the tap. `POST` still needs a signed-in caller and spends
a metered minute (`lib/palVoiceMetering.ts`).

---

## What does not need a key

Do not gate the concierge tools behind any of this. `cheapest_pint_near`,
`tonight_now`, `venue_drinks`, `find_desk` and `report_occupancy` all answer
keylessly from lanes we already hold. One of them is honest about holding
nothing yet, and one writes only on a confirm:

- **`find_desk`** answers only from cafe, co-working and library rows. The
  London pack carries none of those today, so it says "No seat data yet" rather
  than offering a pub as a desk.
- **`report_occupancy`** proposes a crowd report (empty / some seats / full)
  and writes nothing until the reader confirms. Confirm POSTs
  `/api/venues/[id]/occupancy`. `occupancyStoreState()` is the one switch
  that can roll that confirm back to unbuilt.

---

## Related

- `docs/adr/0006-pub-pal-user-owned-digital-companion.md` - what a Pal may do
- `docs/adr/0014-night-os-ask-agent.md` - the tool allowlist
- `docs/VOICE.md` - how every line above had to read
