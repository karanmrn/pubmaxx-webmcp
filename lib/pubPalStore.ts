import "server-only";

import { randomUUID } from "node:crypto";
import { cleanPalDraft, compatiblePalSpecies, type MasteryEvent, type PalProposalPreferences, type PubPal, type PubPalMemory, type PubPalMemoryKind } from "@/lib/pubPal";
import { cleanText } from "@/lib/textClean";
import { admin } from "@/lib/storeBackend";
import { isSupabaseConfigured } from "@/lib/supabase";

const pals = new Map<string, PubPal>();
const memories = new Map<string, PubPalMemory[]>();

export function __resetPubPalStore(): void {
  pals.clear();
  memories.clear();
}

const DEFAULT_PROPOSAL_PREFERENCES: PalProposalPreferences = { memories: false, routes: true };
export type PubPalStoreResult<T> = { ok: true; value: T } | { ok: false; error: "not_found" | "error" };

function proposalPreferences(value: unknown, fallback: PalProposalPreferences = DEFAULT_PROPOSAL_PREFERENCES): PalProposalPreferences {
  if (!value || typeof value !== "object") return fallback;
  const input = value as Record<string, unknown>;
  return {
    memories: typeof input.memories === "boolean" ? input.memories : fallback.memories,
    routes: typeof input.routes === "boolean" ? input.routes : fallback.routes,
  };
}

function palFromRow(row: Record<string, unknown>): PubPal {
  const appearance = row.appearance as PubPal["appearance"];
  return { id: String(row.id), ownerId: String(row.owner_id), name: String(row.name), adultAttestedAt: String(row.adult_attested_at), appearance: { ...appearance, species: compatiblePalSpecies(appearance?.species) ?? "robin" }, personality: row.personality as PubPal["personality"], voice: row.voice as PubPal["voice"], muted: Boolean(row.muted), hidden: Boolean(row.hidden), proposalPreferences: proposalPreferences(row.proposal_preferences), masteryPoints: Number(row.mastery_points ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function memoryFromRow(row: Record<string, unknown>): PubPalMemory {
  return {
    id: String(row.id),
    palId: String(row.pal_id),
    kind: row.kind as PubPalMemoryKind,
    value: String(row.value),
    provenance: row.provenance as PubPalMemory["provenance"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

export async function getPubPalResult(ownerId: string): Promise<PubPalStoreResult<PubPal | null>> {
  if (!isSupabaseConfigured()) return { ok: true, value: pals.get(ownerId) ?? null };
  try {
    const { data, error } = await admin().from("pub_pals").select("*").eq("owner_id", ownerId).maybeSingle();
    if (error) return { ok: false, error: "error" };
    return { ok: true, value: data ? palFromRow(data as Record<string, unknown>) : null };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function getPubPal(ownerId: string): Promise<PubPal | null> {
  const result = await getPubPalResult(ownerId);
  return result.ok ? result.value : null;
}

export async function createPubPalResult(ownerId: string, raw: unknown): Promise<PubPalStoreResult<PubPal>> {
  const draft = cleanPalDraft(raw); if (!draft) return { ok: false, error: "not_found" };
  const existingResult = await getPubPalResult(ownerId);
  if (!existingResult.ok) return existingResult;
  const existing = existingResult.value;
  if (existing) return { ok: true, value: existing };
  const now = new Date().toISOString();
  const controls = raw as Record<string, unknown>;
  const preferences = proposalPreferences(controls.proposalPreferences);
  const pal: PubPal = { id: randomUUID(), ownerId, name: draft.name, adultAttestedAt: now, appearance: draft.appearance, personality: draft.personality, voice: draft.voice, muted: controls.muted === true, hidden: controls.hidden === true, proposalPreferences: preferences, masteryPoints: 0, createdAt: now, updatedAt: now };
  if (!isSupabaseConfigured()) { pals.set(ownerId, pal); return { ok: true, value: pal }; }
  try {
    const { data, error } = await admin().from("pub_pals").insert({ id: pal.id, owner_id: ownerId, name: pal.name, adult_attested_at: now, appearance: pal.appearance, personality: pal.personality, voice: pal.voice, muted: pal.muted, hidden: pal.hidden, proposal_preferences: pal.proposalPreferences }).select("*").single();
    return error || !data ? { ok: false, error: "error" } : { ok: true, value: palFromRow(data as Record<string, unknown>) };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function createPubPal(ownerId: string, raw: unknown): Promise<PubPal | null> {
  const result = await createPubPalResult(ownerId, raw);
  return result.ok ? result.value : null;
}

export async function updatePubPalResult(ownerId: string, raw: unknown): Promise<PubPalStoreResult<PubPal>> {
  const existingResult = await getPubPalResult(ownerId);
  if (!existingResult.ok) return existingResult;
  const existing = existingResult.value;
  if (!existing || !raw || typeof raw !== "object") return { ok: false, error: "not_found" };
  const input = raw as Record<string, unknown>;
  const next: PubPal = { ...existing, muted: typeof input.muted === "boolean" ? input.muted : existing.muted, hidden: typeof input.hidden === "boolean" ? input.hidden : existing.hidden, proposalPreferences: proposalPreferences(input.proposalPreferences, existing.proposalPreferences), updatedAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) { pals.set(ownerId, next); return { ok: true, value: next }; }
  const patch: Record<string, unknown> = { updated_at: next.updatedAt };
  if (typeof input.muted === "boolean") patch.muted = input.muted;
  if (typeof input.hidden === "boolean") patch.hidden = input.hidden;
  if (input.proposalPreferences && typeof input.proposalPreferences === "object") patch.proposal_preferences = next.proposalPreferences;
  try {
    const { data, error } = await admin().from("pub_pals").update(patch).eq("owner_id", ownerId).select("*").maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data ? { ok: true, value: palFromRow(data as Record<string, unknown>) } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function deletePubPalResult(ownerId: string): Promise<PubPalStoreResult<true>> {
  if (!isSupabaseConfigured()) {
    const pal = pals.get(ownerId);
    if (!pal) return { ok: false, error: "not_found" };
    memories.delete(pal.id);
    pals.delete(ownerId);
    return { ok: true, value: true };
  }
  try {
    const { data, error } = await admin().from("pub_pals").delete().eq("owner_id", ownerId).select("id").maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data ? { ok: true, value: true } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function listPalMemoriesResult(ownerId: string): Promise<PubPalStoreResult<PubPalMemory[]>> {
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return palResult;
  const pal = palResult.value;
  if (!pal) return { ok: false, error: "not_found" };
  if (!isSupabaseConfigured()) return { ok: true, value: memories.get(pal.id) ?? [] };
  try {
    const { data, error } = await admin().from("pub_pal_memories").select("*").eq("pal_id", pal.id).order("created_at", { ascending: false });
    if (error || !data) return { ok: false, error: "error" };
    return { ok: true, value: data.map((row) => memoryFromRow(row as Record<string, unknown>)) };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function confirmPalMemoryResult(ownerId: string, raw: unknown): Promise<PubPalStoreResult<PubPalMemory>> {
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return palResult;
  const pal = palResult.value;
  if (!pal || !raw || typeof raw !== "object") return { ok: false, error: "not_found" };
  const input = raw as Record<string, unknown>; const value = cleanText(input.value, 500); const allowed: PubPalMemoryKind[] = ["venue_preference", "atmosphere_preference", "accessibility_preference", "transport_preference", "drink_preference", "night_outcome", "correction"];
  const kind = typeof input.kind === "string" && allowed.includes(input.kind as PubPalMemoryKind) ? input.kind as PubPalMemoryKind : null; if (!kind || !value) return { ok: false, error: "not_found" };
  const timestamp = new Date().toISOString();
  const memory: PubPalMemory = { id: randomUUID(), palId: pal.id, kind, value, provenance: kind === "correction" ? "user_correction" : "user_confirmed", createdAt: timestamp, updatedAt: timestamp };
  if (!isSupabaseConfigured()) { memories.set(pal.id, [memory, ...(memories.get(pal.id) ?? [])]); return { ok: true, value: memory }; }
  try {
    const { error } = await admin().from("pub_pal_memories").insert({ id: memory.id, pal_id: pal.id, kind, value, provenance: memory.provenance, created_at: memory.createdAt, updated_at: memory.updatedAt });
    return error ? { ok: false, error: "error" } : { ok: true, value: memory };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function updatePalMemoryResult(ownerId: string, memoryId: string, raw: unknown): Promise<PubPalStoreResult<PubPalMemory>> {
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return palResult;
  const pal = palResult.value;
  if (!pal || !memoryId || !raw || typeof raw !== "object") return { ok: false, error: "not_found" };
  const input = raw as Record<string, unknown>;
  const value = cleanText(input.value, 500);
  if (!value) return { ok: false, error: "not_found" };
  const timestamp = new Date().toISOString();
  if (!isSupabaseConfigured()) {
    const current = memories.get(pal.id) ?? [];
    const existing = current.find((memory) => memory.id === memoryId);
    if (!existing) return { ok: false, error: "not_found" };
    const updated: PubPalMemory = { ...existing, value, provenance: "user_correction", updatedAt: timestamp };
    memories.set(pal.id, current.map((memory) => memory.id === memoryId ? updated : memory));
    return { ok: true, value: updated };
  }
  try {
    const { data, error } = await admin().from("pub_pal_memories")
      .update({ value, provenance: "user_correction", updated_at: timestamp })
      .eq("id", memoryId)
      .eq("pal_id", pal.id)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data
      ? { ok: true, value: memoryFromRow(data as Record<string, unknown>) }
      : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function deletePalMemoryResult(ownerId: string, memoryId: string): Promise<PubPalStoreResult<true>> {
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return palResult;
  const pal = palResult.value;
  if (!pal || !memoryId) return { ok: false, error: "not_found" };
  if (!isSupabaseConfigured()) {
    const current = memories.get(pal.id) ?? [];
    if (!current.some((memory) => memory.id === memoryId)) return { ok: false, error: "not_found" };
    memories.set(pal.id, current.filter((memory) => memory.id !== memoryId));
    return { ok: true, value: true };
  }
  try {
    const { data, error } = await admin().from("pub_pal_memories")
      .delete()
      .eq("id", memoryId)
      .eq("pal_id", pal.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data ? { ok: true, value: true } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function addMasteryEvent(ownerId: string, raw: unknown): Promise<MasteryEvent | null> {
  // No mastery event is client-awardable. The existing sources (Plans, Pint
  // Drops, venue reads, and Night Memories) do not all have an authenticated
  // ownership join, so accepting an arbitrary { kind, sourceId } is forgeable.
  // Trusted server workflows can add a source-bound internal writer later.
  void ownerId;
  void raw;
  return null;
}
