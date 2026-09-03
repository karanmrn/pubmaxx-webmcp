// "The Landlord" — a retrieval-grounded heritage Q&A helper for a single pub.
//
// Grounding contract: every answer is built ONLY from facts we retrieved. The
// no-key path never invents anything — it just reads back the facts on record,
// or says plainly that there is no fuller story. The LLM path is instructed to
// do the same and falls back to the honest structured answer on any failure.
//
// Trust boundary: ALL venue context is reconstructed server-side. Facts come
// ONLY from server-owned stores: the shipped heritage_cache.json and the
// Supabase `pub_heritage` table (keyed by normalised venue name), plus cited
// harvest overlay lore keyed by OSM id. The route no longer accepts a client
// `context` object at all, so a client cannot forge pub history — not even as
// a labelled contributor note. If server facts are missing, the honest
// fallback stands.

import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { discardBody } from "@/lib/responseBody";
import { normaliseVenueName } from "@/lib/curation";
import { heritageFactFromOverlay } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { resolveHarvestOverlayVenue } from "@/lib/harvestOverlayVenue";
import { getListedBuilding } from "@/lib/heritageListings";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { venueKindNoun } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import type { HarvestOverlayVenueResolution } from "@/lib/harvestOverlayVenue";

// Every source is a server-side (sourced) store. There is no client-supplied
// source anymore — the route reconstructs context from server data only.
export type HeritageFact = {
  source: "osm" | "wikidata" | "wikipedia" | "seed" | "nhle" | "web";
  fact: string;
  sourceRef?: string;
};

// Sources that count as trusted/sourced facts (server-retrieved). "nhle" is
// Historic England's official National Heritage List for England. "web" is
// cited harvest lore, keyed by OSM id (never by pub name).
const SOURCED: ReadonlySet<HeritageFact["source"]> = new Set([
  "osm",
  "wikidata",
  "wikipedia",
  "seed",
  "nhle",
  "web",
]);

export function storedFactSource(value: unknown): HeritageFact["source"] | null {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (source === "web") return null;
  if (!SOURCED.has(source as HeritageFact["source"])) return null;
  return source as HeritageFact["source"];
}

export type HeritageResponse = {
  answer: string;
  citations: { source: string; ref?: string }[];
  clarifyingQuestion?: string;
};

const HERITAGE_CACHE_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "heritage_cache.json",
);

// The single honest empty answer. Kept as a constant so the route, the fallback,
// and the test all agree on the exact wording.
export const NO_STORY_LINE =
  "I've got the basics but no fuller story on record yet. I won't make one up.";

// Read the cache defensively: subagent C owns this file, it may be missing or
// malformed. Any problem → treat as {} rather than throwing.
async function readHeritageCache(): Promise<Record<string, HeritageFact[]>> {
  try {
    const raw = await readFile(HERITAGE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, HeritageFact[]>;
  } catch {
    return {};
  }
}

// Keyed by venue_key (= normaliseVenueName), the same key the enrichment
// script writes and the migration indexes.
async function retrieveFromSupabase(venueKey: string): Promise<HeritageFact[]> {
  if (!venueKey || !isSupabaseConfigured()) return [];
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const { data, error } = await admin
      .from("pub_heritage")
      .select("source, fact, source_ref")
      .eq("venue_key", venueKey);
    if (error || !Array.isArray(data)) return [];
    const facts: HeritageFact[] = [];
    for (const row of data) {
      if (!row || typeof row.fact !== "string" || !row.fact.trim()) continue;
      const source = storedFactSource(row.source);
      if (!source) continue;
      facts.push({
        source,
        fact: row.fact,
        sourceRef: (row.source_ref as string | null) ?? undefined,
      });
    }
    return facts;
  } catch {
    // Best-effort only — the demo must never fall over on a DB hiccup.
    return [];
  }
}

export type HeritageReadResult = {
  status: "ready" | "degraded";
  facts: HeritageFact[];
};

export async function retrieveHeritageWithStatus(input: {
  venueId?: string;
  venueName: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageReadResult> {
  const facts: HeritageFact[] = [];
  let status: HeritageReadResult["status"] = "ready";
  const overlayResolution = input.venueId
    ? input.overlayVenueResolution ?? (await resolveHarvestOverlayVenue(input.venueId))
    : undefined;
  const baseVenueLookup = input.venueId
    ? await lookupCanonicalVenue(input.venueId)
    : undefined;
  const serverVenueName = overlayResolution?.status === "resolved"
    ? overlayResolution.venue?.name ??
      (baseVenueLookup?.status === "found" ? baseVenueLookup.venue.name : undefined)
    : baseVenueLookup?.status === "found"
      ? baseVenueLookup.venue.name
      : undefined;
  const venueKey = normaliseVenueName(input.venueId ? serverVenueName ?? "" : input.venueName);

  // (0) Listed-building fact first — the official register (Historic England
  // NHLE), keyed by the exact venue id so it can never attach to the wrong
  // same-named pub. This is the authoritative "brass plaque" line, so it leads.
  const listed = await getListedBuilding(input.venueId);
  if (listed) {
    facts.push({ source: "nhle", fact: listed.fact, sourceRef: listed.url });
  }

  if (!input.venueId || serverVenueName) {
    // (1) Server facts first — the shipped cache keyed by normalised name.
    const cache = await readHeritageCache();
    const cached = cache[venueKey];
    if (Array.isArray(cached)) {
      for (const entry of cached) {
        if (!entry || typeof entry.fact !== "string" || !entry.fact.trim()) continue;
        const source = storedFactSource(entry.source);
        if (!source) continue;
        facts.push({
          source,
          fact: entry.fact,
          sourceRef: entry.sourceRef,
        });
      }
    }

    // (2) Server rows — Supabase pub_heritage, same venue_key.
    facts.push(...(await retrieveFromSupabase(venueKey)));
  }

  // (3) Harvest overlay lore — OSM id only. Name is never a key. Uncited
  // lore cannot be stored, and heritageFactFromOverlay drops a row that
  // somehow lost its https citation.
  if (input.venueId && overlayResolution) {
    const resolution = overlayResolution;
    if (resolution.status === "unavailable") {
      status = "degraded";
    } else if (resolution.status === "resolved") {
      const reads = await Promise.all(
        resolution.venueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
      );
      if (reads.some((read) => read.status === "degraded")) {
        status = "degraded";
      } else {
        for (const read of reads) {
          const lore = read.status === "ready" && read.overlay
            ? heritageFactFromOverlay(read.overlay)
            : null;
          if (lore) facts.push(lore);
        }
      }
    }
  }

  // No client context is accepted — the route derives everything from
  // server-owned stores.
  return { status, facts };
}

export async function retrieveHeritage(input: {
  venueId?: string;
  venueName: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageFact[]> {
  return (await retrieveHeritageWithStatus(input)).facts;
}

function dedupeCitations(
  facts: HeritageFact[],
): { source: string; ref?: string }[] {
  const seen = new Set<string>();
  const citations: { source: string; ref?: string }[] = [];
  for (const fact of facts) {
    const key = `${fact.source}::${fact.sourceRef ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(fact.sourceRef ? { source: fact.source, ref: fact.sourceRef } : { source: fact.source });
  }
  return citations;
}

// Honest structured-only answer: read the facts back, never add to them.
function structuredAnswer(facts: HeritageFact[]): string {
  if (facts.length === 0) return NO_STORY_LINE;
  return `Here's what's on record: ${facts.map((f) => f.fact.replace(/\.$/, "")).join("; ")}.`;
}

function systemPrompt(venueNoun: string): string {
  return [
    `You are the PUBMAXXER, a warm, concise, knowledgeable London local answering questions about one ${venueNoun}.`,
    "Answer ONLY from the CONTEXT facts provided. Never invent history, dates, names, or events.",
    "Each CONTEXT fact is numbered like [F1]. When you use a fact, cite its id inline (e.g. [F1]). Never cite an id that does not appear in the CONTEXT.",
    "If the context does not contain the answer, say so plainly. Do not guess.",
    "Also name the source of each fact inline (e.g. 'on record', 'Wikipedia').",
    "Ask ONE short clarifying question only if the question is ambiguous or there is no context at all.",
  ].join(" ");
}

// LLM bounds (PRD P3.10): deterministic, capped, and time-boxed. Any failure
// mode — timeout, network, bad status, phantom citation — returns null and the
// caller falls back to the honest structured answer.
const LLM_TIMEOUT_MS = 10_000;
const LLM_MAX_TOKENS = 400; // answers are a short paragraph; caps cost + runaway output

// Facts are numbered [F1]..[Fn] in the prompt. An answer citing an id outside
// the retrieved set is fabrication → reject the whole answer (null). Valid
// markers are stripped before the answer reaches the client.
const FACT_ID_RE = /\[F(\d+)\]/g;

function sanitiseModelAnswer(answer: string, factCount: number): string | null {
  for (const match of answer.matchAll(FACT_ID_RE)) {
    const id = Number(match[1]);
    if (id < 1 || id > factCount) return null;
  }
  const cleaned = answer
    .replace(FACT_ID_RE, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned || null;
}

async function answerWithModel(
  question: string,
  facts: HeritageFact[],
  venueNoun: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const contextBlock = facts.length
      ? facts.map((f, i) => `- [F${i + 1}] (${f.source}) ${f.fact}`).join("\n")
      : "(no facts on record)";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-5",
        temperature: 0,
        max_tokens: LLM_MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt(venueNoun) },
          { role: "user", content: `CONTEXT:\n${contextBlock}\n\nQUESTION: ${question}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return null;
    return sanitiseModelAnswer(text.trim(), facts.length);
  } catch {
    // Timeout/abort/network — never surface; the honest fallback takes over.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// P2 — 5-minute in-memory cache for LLM answers. Keyed by canonical venue
// identity plus a hash of the question, so it cannot leak answers across OSM
// venues. Only the paid LLM path is cached (the deterministic fallback is
// already cheap), and
// hidden/moderated content never flows through here — facts come from the
// server stores, and a bounded TTL means a moderation change is reflected within
// five minutes. Bounded to ANSWER_CACHE_MAX entries with insertion-order eviction
// (Map iteration is insertion-order) so a hostile stream of (venue, question)
// pairs can't grow the process memory without limit.
const ANSWER_CACHE_TTL_MS = 5 * 60_000;
const ANSWER_CACHE_MAX = 500;
const answerCache = new Map<string, { at: number; response: HeritageResponse }>();

function setAnswerCache(key: string, entry: { at: number; response: HeritageResponse }): void {
  // Refreshing an existing key must not double-count against the bound.
  if (answerCache.has(key)) answerCache.delete(key);
  answerCache.set(key, entry);
  while (answerCache.size > ANSWER_CACHE_MAX) {
    const oldest = answerCache.keys().next().value;
    if (oldest === undefined) break;
    answerCache.delete(oldest);
  }
}

function cacheKey(
  venueName: string,
  question: string,
  venueNoun: string,
  venueIdentity: string,
): string {
  const qHash = createHash("sha256")
    .update(`${venueIdentity}\0${venueNoun}\0${question}`)
    .digest("hex");
  return `${venueIdentity || normaliseVenueName(venueName)}::${qHash}`;
}

export async function answerHeritage(input: {
  venueId?: string;
  venueName: string;
  venueKind?: VenueKind;
  question: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageResponse> {
  const venueNoun = venueKindNoun(input.venueKind);
  const useLlm = Boolean(process.env.OPENROUTER_API_KEY);
  const venueResolution = input.overlayVenueResolution ?? (input.venueId
    ? await resolveHarvestOverlayVenue(input.venueId)
    : null);
  const venueIdentity = venueResolution?.status === "resolved"
    ? venueResolution.venueIds.join(",")
    : input.venueId ?? "";
  const key = useLlm && venueResolution?.status !== "unavailable"
    ? cacheKey(input.venueName, input.question, venueNoun, venueIdentity)
    : null;

  if (key) {
    const hit = answerCache.get(key);
    if (hit && Date.now() - hit.at < ANSWER_CACHE_TTL_MS) return hit.response;
    if (hit) answerCache.delete(key); // expired — prune on read
  }

  const heritageRead = await retrieveHeritageWithStatus({
    ...input,
    overlayVenueResolution: venueResolution ?? undefined,
  });
  const facts = heritageRead.facts;
  const citations = dedupeCitations(facts);

  if (useLlm && key) {
    const modelAnswer = await answerWithModel(input.question, facts, venueNoun);
    if (modelAnswer) {
      const response: HeritageResponse = { answer: modelAnswer, citations };
      if (heritageRead.status === "ready") {
        setAnswerCache(key, { at: Date.now(), response });
      }
      return response;
    }
    // else: fall through to the honest structured answer (not cached — cheap).
  }

  const answer = structuredAnswer(facts);
  const response: HeritageResponse = { answer, citations };
  if (facts.length === 0) {
    response.clarifyingQuestion = `What would you like to know about this ${venueNoun}?`;
  }
  return response;
}

// Test-only: clear the answer cache between cases.
export function __resetHeritageCache(): void {
  answerCache.clear();
}

// Test-only: current answer-cache size, for asserting the bound holds.
export function __heritageCacheSizeForTests(): number {
  return answerCache.size;
}

// Test-only: the answer-cache upper bound, so tests aren't coupled to the value.
export const __HERITAGE_CACHE_MAX_FOR_TESTS = ANSWER_CACHE_MAX;
