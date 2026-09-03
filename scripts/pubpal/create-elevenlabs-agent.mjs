#!/usr/bin/env node
// Create or update the Pub Pal ElevenLabs Agent, idempotently.
//
// The agent is a THIN SHELL. It owns no knowledge: every answer comes from our
// own tool registry through the Custom LLM bridge at /api/pub-pal/llm, which
// runs the same grounded Night OS Ask path the text surface runs (ADR 0014).
// So this script sets four things and nothing else:
//
//   1. the Custom LLM URL plus its shared secret,
//   2. zero audio and transcript retention,
//   3. the three curated voices, when their ids are set,
//   4. the house first message and the propose-then-confirm rule (ADR 0006).
//
// Idempotent: with ELEVENLABS_PUB_PAL_AGENT_ID set it PATCHes that agent;
// without one it looks for an agent of the same name before creating a new
// one, so a re-run never leaves two Pals in the dashboard.
//
// Usage:
//   node scripts/pubpal/create-elevenlabs-agent.mjs --base-url https://pubmaxxing.com
//   node scripts/pubpal/create-elevenlabs-agent.mjs --dry-run
//
// Reads .env.local / .env if present, so a local run needs no exported shell
// variables. See docs/PUB_PAL_SETUP.md.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PAL_VOICE_MAX_SESSION_SECONDS } from "../../lib/palVoiceCap.mjs";

const API = "https://api.elevenlabs.io/v1/convai";
const AGENT_NAME = "PUBMAXX Pub Pal";
const MAX_SESSION_SECONDS = PAL_VOICE_MAX_SESSION_SECONDS;

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * The prompt the agent runs under.
 *
 * It deliberately forbids the model from answering from its own knowledge: the
 * Custom LLM behind it already returns a grounded answer, so the agent's job is
 * to SPEAK it. A voice that improvises a price would spend the whole trust
 * argument the product rests on.
 */
function systemPrompt() {
  return [
    "You are the Pub Pal, a London night companion on PUBMAXX.",
    "Every answer you speak comes back from the PUBMAXX tools. Speak what they return and nothing else.",
    "Never invent a pub, a price, an opening hour, or an event. If the tools say nothing is on record, say that.",
    "British spelling. No exclamation marks. No em dashes. Short sentences.",
    "You may propose a plan or a saved fact, but you never apply one. Say what you would do and ask the person to confirm it in the app.",
    "When the night turns to getting home, last trains, rides, or sobriety, switch to plain speech: one fact per sentence, no jokes, and hand off to the Getting Home tab.",
    `End the call once it reaches ${MAX_SESSION_SECONDS} seconds or the person is done.`,
  ].join("\n");
}

function agentBody(llmUrl, secret) {
  const voices = {
    ember: process.env.ELEVENLABS_VOICE_EMBER?.trim(),
    velvet: process.env.ELEVENLABS_VOICE_VELVET?.trim(),
    signal: process.env.ELEVENLABS_VOICE_SIGNAL?.trim(),
  };
  const body = {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt(),
          // The whole point: our own grounded registry answers, not the
          // provider's model. `custom_llm` carries the shared secret so
          // /api/pub-pal/llm can refuse anybody else.
          llm: "custom-llm",
          custom_llm: {
            url: llmUrl,
            model_id: "pubmax-ask-grounded",
            api_key: { secret: secret },
          },
        },
        first_message: "Hello, I'm your Pub Pal. What kind of night are you planning?",
        language: "en",
      },
      conversation: {
        max_duration_seconds: MAX_SESSION_SECONDS,
      },
      // Zero retention (ADR 0006): raw audio and transcripts are never
      // source-of-truth memory, so the provider must not keep either.
      ...(voices.ember ? { tts: { voice_id: voices.ember } } : {}),
    },
    platform_settings: {
      privacy: {
        record_voice: false,
        retention_days: 0,
        delete_transcript_and_pii: true,
        zero_retention_mode: true,
      },
    },
  };
  return { body, voices };
}

/**
 * A copy of the agent body with the Custom LLM secret held back.
 *
 * The dry run is the documented pre-flight, so its output lands in terminal
 * scrollback and in any CI log. The secret is what guards /api/pub-pal/llm, so
 * only its length is printed. The real request still carries the true value.
 */
function redactSecret(body) {
  const apiKey = body?.conversation_config?.agent?.prompt?.custom_llm?.api_key;
  if (!apiKey || typeof apiKey.secret !== "string") return body;
  return {
    ...body,
    conversation_config: {
      ...body.conversation_config,
      agent: {
        ...body.conversation_config.agent,
        prompt: {
          ...body.conversation_config.agent.prompt,
          custom_llm: {
            ...body.conversation_config.agent.prompt.custom_llm,
            api_key: {
              ...apiKey,
              secret: `[redacted, ${apiKey.secret.length} characters]`,
            },
          },
        },
      },
    },
  };
}

async function call(method, url, apiKey, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "xi-api-key": apiKey,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`${method} ${url} answered ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function findAgentByName(apiKey) {
  const listed = await call("GET", `${API}/agents?page_size=100`, apiKey);
  const rows = Array.isArray(listed.agents) ? listed.agents : [];
  const hit = rows.find((row) => row?.name === AGENT_NAME);
  return hit?.agent_id ?? null;
}

async function main() {
  loadDotEnv();

  const dryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const secret = process.env.ELEVENLABS_LLM_SHARED_SECRET?.trim();
  const baseUrl = (arg("base-url", process.env.PUBMAX_BASE_URL ?? "")).trim().replace(/\/+$/, "");

  if (!dryRun && !apiKey) fail("ELEVENLABS_API_KEY is not set. See docs/PUB_PAL_SETUP.md.");
  if (!secret) fail("ELEVENLABS_LLM_SHARED_SECRET is not set. Generate one: openssl rand -hex 32");
  if (!baseUrl) fail("Pass --base-url https://your-deployment (or set PUBMAX_BASE_URL).");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) {
    fail(`--base-url must be https (or http://localhost for a tunnel test). Got: ${baseUrl}`);
  }

  const llmUrl = `${baseUrl}/api/pub-pal/llm`;
  const { body, voices } = agentBody(llmUrl, secret);

  if (dryRun) {
    console.log(
      "Dry run. This is the agent that would be written, with the shared secret held back:\n",
    );
    console.log(
      JSON.stringify({ ...redactSecret(body), custom_llm_url: llmUrl }, null, 2),
    );
    console.log("\nVoices resolved:", voices);
    return;
  }

  const existing = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim() || (await findAgentByName(apiKey));

  if (existing) {
    await call("PATCH", `${API}/agents/${existing}`, apiKey, body);
    console.log(`✓ Updated agent ${existing}`);
    console.log(`  Custom LLM: ${llmUrl}`);
  } else {
    const created = await call("POST", `${API}/agents/create`, apiKey, body);
    const agentId = created.agent_id ?? created.id;
    if (!agentId) fail("ElevenLabs returned no agent id.");
    console.log(`✓ Created agent ${agentId}`);
    console.log(`  Custom LLM: ${llmUrl}`);
    console.log(`\n  Set this on the deployment:\n    ELEVENLABS_PUB_PAL_AGENT_ID=${agentId}`);
  }

  const missing = Object.entries(voices)
    .filter(([, id]) => !id)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.log(
      `\n  Voice ids not set for: ${missing.join(", ")}. Those Pals fall back to the agent default.`,
    );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
