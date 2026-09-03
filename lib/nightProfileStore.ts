import "server-only";

import {
  cleanNightProfile,
  nightProfileInput,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

export type NightProfilePutResult =
  | { ok: true; profile: NightProfile }
  | { ok: false; error: "conflict"; current: NightProfile | null };

export type NightProfileStore = {
  get(ownerId: string): Promise<NightProfile | null>;
  put(
    ownerId: string,
    input: NightProfileInput,
    expectedUpdatedAt: string | null,
  ): Promise<NightProfilePutResult>;
};

const memoryProfiles = new Map<string, NightProfile>();

export function __resetNightProfileStore(): void {
  memoryProfiles.clear();
}

function sameInput(current: NightProfile, input: NightProfileInput): boolean {
  return JSON.stringify(nightProfileInput(current)) === JSON.stringify(input);
}

export const memoryNightProfileStore: NightProfileStore = {
  async get(ownerId) {
    return memoryProfiles.get(ownerId) ?? null;
  },
  async put(ownerId, input, expectedUpdatedAt) {
    const current = memoryProfiles.get(ownerId) ?? null;
    if (
      (expectedUpdatedAt === null && current) ||
      (expectedUpdatedAt !== null && current?.updatedAt !== expectedUpdatedAt)
    ) {
      return { ok: false, error: "conflict", current };
    }
    if (current && sameInput(current, input)) return { ok: true, profile: current };
    const timestamp = new Date().toISOString();
    const profile: NightProfile = {
      ...input,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memoryProfiles.set(ownerId, profile);
    return { ok: true, profile };
  },
};

function fromRow(row: Record<string, unknown>): NightProfile {
  const profile = cleanNightProfile({
    version: Number(row.schema_version),
    cityId: row.city_id,
    context: {
      nightArea: row.night_area,
      daypart: row.daypart,
      partyType: row.party_type,
      groupSize: row.group_size,
      budget: row.budget,
      budgetLimitPence: row.budget_limit_pence,
      zeroProof: row.zero_proof,
      // The durable table has no wetherspoons column yet; planner context still
      // requires the flag, so legacy rows default to false on read.
      wetherspoonsPreferred: row.wetherspoons_preferred === true,
      atmosphere: row.atmosphere,
      foodNeeds: row.food_needs,
      accessibility: row.accessibility,
      transportConstraints: row.transport_constraints,
    },
    briefingPreferences: row.briefing_preferences,
    voicePreference: row.voice_preference,
    pubPalId: row.pub_pal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!profile) throw new Error("Stored Night Profile is invalid.");
  return profile;
}

function toRow(ownerId: string, input: NightProfileInput, timestamp: string) {
  return {
    owner_id: ownerId,
    schema_version: input.version,
    city_id: input.cityId,
    night_area: input.context.nightArea,
    daypart: input.context.daypart,
    party_type: input.context.partyType,
    group_size: input.context.groupSize,
    budget: input.context.budget,
    budget_limit_pence: input.context.budgetLimitPence,
    zero_proof: input.context.zeroProof,
    atmosphere: input.context.atmosphere,
    food_needs: input.context.foodNeeds,
    accessibility: input.context.accessibility,
    transport_constraints: input.context.transportConstraints,
    briefing_preferences: input.briefingPreferences,
    voice_preference: input.voicePreference,
    pub_pal_id: input.pubPalId,
    updated_at: timestamp,
  };
}

export const supabaseNightProfileStore: NightProfileStore = {
  async get(ownerId) {
    const { data, error } = await requireSupabaseAdmin()
      .from("night_profiles")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data as Record<string, unknown>) : null;
  },
  async put(ownerId, input, expectedUpdatedAt) {
    const current = await this.get(ownerId);
    if (
      (expectedUpdatedAt === null && current) ||
      (expectedUpdatedAt !== null && current?.updatedAt !== expectedUpdatedAt)
    ) {
      return { ok: false, error: "conflict", current };
    }
    if (current && sameInput(current, input)) return { ok: true, profile: current };

    const timestamp = new Date().toISOString();
    const admin = requireSupabaseAdmin();
    if (!current) {
      const { data, error } = await admin
        .from("night_profiles")
        .insert(toRow(ownerId, input, timestamp))
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") {
          return { ok: false, error: "conflict", current: await this.get(ownerId) };
        }
        throw new Error(error.message);
      }
      return { ok: true, profile: fromRow(data as Record<string, unknown>) };
    }

    const { data, error } = await admin
      .from("night_profiles")
      .update(toRow(ownerId, input, timestamp))
      .eq("owner_id", ownerId)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: "conflict", current: await this.get(ownerId) };
    return { ok: true, profile: fromRow(data as Record<string, unknown>) };
  },
};

export function nightProfileStore(): NightProfileStore {
  return selectStore(memoryNightProfileStore, supabaseNightProfileStore);
}
