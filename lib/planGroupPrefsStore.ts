import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  overlapGroupPrefs,
  parseGroupPrefWriteInput,
  parseMatePreference,
  type GroupPrefWriteInput,
  type GroupPrefsOverlap,
  type MatePreference,
} from "@/lib/groupPrefs";
import { isPlanId } from "@/lib/plan";
import { legacyPlanMemberIdentityResult } from "@/lib/planStore";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type PlanGroupPrefsError = "invalid" | "not_found" | "forbidden" | "error";
type Failure = { ok: false; error: PlanGroupPrefsError };

export type PlanGroupPrefsList = {
  ok: true;
  memberId: string;
  role: "host" | "guest";
  prefs: MatePreference[];
  overlap: GroupPrefsOverlap;
};

type StoredPref = MatePreference & { planId: string };

type PrefMemory = {
  prefs: Map<string, StoredPref>;
  idempotency: Map<string, { ok: true; pref: MatePreference }>;
};

const globalMemory = globalThis as typeof globalThis & { __pubmaxPlanGroupPrefs?: PrefMemory };
const memory = globalMemory.__pubmaxPlanGroupPrefs ??= {
  prefs: new Map(),
  idempotency: new Map(),
};

function prefMapKey(planId: string, memberId: string): string {
  return `${planId}:${memberId}`;
}

function idempotencyKey(planId: string, memberId: string, key: string): string {
  return `${planId}:${memberId}:group-pref:${key.trim()}`;
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 120;
}

async function authorizedMember(planId: string, token: unknown) {
  const result = await legacyPlanMemberIdentityResult(planId, token);
  if (!result.ok) return { ok: false as const, error: result.error };
  const identity = result.identity;
  if (!identity || (identity.role !== "host" && !identity.collaborationAuthorized)) {
    return { ok: false as const, error: "forbidden" as const };
  }
  return { ok: true as const, identity };
}

function fromRow(row: Record<string, unknown>): MatePreference {
  return {
    mateId: String(row.member_id),
    budgetBand: row.budget_band as MatePreference["budgetBand"],
    atmosphereChips: [row.atmosphere_chip as MatePreference["atmosphereChips"][number]],
    zeroProof: row.zero_proof === true,
    accessibilityRequired: row.accessibility_required === true,
    weatherShelterRequired: row.weather_shelter_required === true,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : String(row.created_at ?? ""),
  };
}

function prefsForPlan(planId: string): MatePreference[] {
  return [...memory.prefs.values()]
    .filter((pref) => pref.planId === planId)
    .map(({ planId: _planId, ...pref }) => {
      void _planId;
      return { ...pref, atmosphereChips: [...pref.atmosphereChips] };
    });
}

export type PlanGroupPrefsStore = {
  list(planId: string, token: unknown): Promise<PlanGroupPrefsList | Failure>;
  save(
    planId: string,
    token: unknown,
    input: GroupPrefWriteInput,
    key: string,
    now?: Date,
  ): Promise<{ ok: true; pref: MatePreference; overlap: GroupPrefsOverlap } | Failure>;
  clear(planId: string, token: unknown): Promise<{ ok: true; overlap: GroupPrefsOverlap } | Failure>;
};

const memoryStore: PlanGroupPrefsStore = {
  async list(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    const prefs = prefsForPlan(planId);
    return {
      ok: true,
      memberId: auth.identity.memberId,
      role: auth.identity.role,
      prefs,
      overlap: overlapGroupPrefs(prefs),
    };
  },

  async save(planId, token, input, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !parseGroupPrefWriteInput(input)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    const idem = idempotencyKey(planId, auth.identity.memberId, key);
    const replay = memory.idempotency.get(idem);
    if (replay) {
      const prefs = prefsForPlan(planId);
      return { ok: true, pref: structuredClone(replay.pref), overlap: overlapGroupPrefs(prefs) };
    }
    const pref: MatePreference = {
      mateId: auth.identity.memberId,
      budgetBand: input.budgetBand,
      atmosphereChips: [input.atmosphereChip],
      zeroProof: input.zeroProof,
      accessibilityRequired: input.accessibilityRequired,
      weatherShelterRequired: input.weatherShelterRequired,
      updatedAt: now.toISOString(),
    };
    memory.prefs.set(prefMapKey(planId, auth.identity.memberId), { ...pref, planId });
    memory.idempotency.set(idem, { ok: true, pref: { ...pref } });
    return { ok: true, pref: { ...pref }, overlap: overlapGroupPrefs(prefsForPlan(planId)) };
  },

  async clear(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    memory.prefs.delete(prefMapKey(planId, auth.identity.memberId));
    const ledgerPrefix = `${planId}:${auth.identity.memberId}:group-pref:`;
    for (const key of [...memory.idempotency.keys()]) {
      if (key.startsWith(ledgerPrefix)) memory.idempotency.delete(key);
    }
    return { ok: true, overlap: overlapGroupPrefs(prefsForPlan(planId)) };
  },
};

const PREFS = "plan_member_group_prefs";

const supabaseStore: PlanGroupPrefsStore = {
  async list(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    return listDurablePrefs(planId, auth.identity.memberId, auth.identity.role);
  },

  async save(planId, token, input, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !parseGroupPrefWriteInput(input)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    const admin = requireSupabaseAdmin();
    const { data: row, error } = await admin.rpc("record_plan_member_group_pref_atomic", {
      p_plan_id: planId,
      p_member_id: auth.identity.memberId,
      p_budget_band: input.budgetBand,
      p_atmosphere_chip: input.atmosphereChip,
      p_zero_proof: input.zeroProof,
      p_accessibility_required: input.accessibilityRequired,
      p_weather_shelter_required: input.weatherShelterRequired,
      p_idempotency_key: key.trim(),
      p_pref_id: randomUUID(),
      p_created_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    if (!row || typeof row !== "object") return { ok: false, error: "invalid" };
    const pref = parseMatePreference(fromRow(row as Record<string, unknown>));
    if (!pref) return { ok: false, error: "error" };
    const listed = await listDurablePrefs(planId, auth.identity.memberId, auth.identity.role);
    if (!listed.ok) return listed;
    return { ok: true, pref, overlap: listed.overlap };
  },

  async clear(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const auth = await authorizedMember(planId, token);
    if (!auth.ok) return auth;
    const admin = requireSupabaseAdmin();
    const deleted = await admin.from(PREFS).delete().eq("plan_id", planId).eq("member_id", auth.identity.memberId);
    if (deleted.error) return { ok: false, error: "error" };
    const ledger = await admin
      .from("plan_member_group_pref_requests")
      .delete()
      .eq("plan_id", planId)
      .eq("member_id", auth.identity.memberId);
    if (ledger.error) return { ok: false, error: "error" };
    const listed = await listDurablePrefs(planId, auth.identity.memberId, auth.identity.role);
    if (!listed.ok) return listed;
    return { ok: true, overlap: listed.overlap };
  },
};

async function listDurablePrefs(
  planId: string,
  memberId: string,
  role: "host" | "guest",
): Promise<PlanGroupPrefsList | Failure> {
  const admin = requireSupabaseAdmin();
  const { data, error } = await admin
    .from(PREFS)
    .select("member_id,budget_band,atmosphere_chip,zero_proof,accessibility_required,weather_shelter_required,created_at,updated_at")
    .eq("plan_id", planId);
  if (error) return { ok: false, error: "error" };
  const prefs = (data ?? [])
    .map((row) => parseMatePreference(fromRow(row as Record<string, unknown>)))
    .filter((pref): pref is MatePreference => Boolean(pref));
  return {
    ok: true,
    memberId,
    role,
    prefs,
    overlap: overlapGroupPrefs(prefs),
  };
}

const safeSupabaseStore = new Proxy(supabaseStore, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver) as unknown;
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      try {
        return await Reflect.apply(value, target, args);
      } catch (error) {
        console.error("[plan-group-prefs] configured store failed:", error instanceof Error ? error.message : error);
        return { ok: false, error: "error" };
      }
    };
  },
}) as PlanGroupPrefsStore;

export function planGroupPrefsStore(): PlanGroupPrefsStore {
  return selectStore(memoryStore, safeSupabaseStore);
}

export function __resetPlanGroupPrefs(): void {
  memory.prefs.clear();
  memory.idempotency.clear();
}

/** Deterministic digest for tests that need a stable idempotency seed. */
export function planGroupPrefIdempotencyDigest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}
