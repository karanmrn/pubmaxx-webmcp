// The Round store. ONE store interface, TWO implementations (process-memory +
// Supabase public.rounds/round_members/round_stops), the exact dual-backend seam
// as notificationsStore / reactionsStore: Supabase when env keys exist, process-
// memory otherwise, chosen at the single roundsStore() seam.
//
// The domain rules the store enforces (mirrored in BOTH backends so the contract
// can't drift):
//   • create      — mints a unique short code, retries on the rare collision.
//   • getByCode    — resolve a Round + its members + stops by its canonical code.
//   • join         — idempotent: unique(round_id, handle). Re-joining is a no-op.
//                    A CLOSED Round can't be joined.
//   • addStop      — idempotent on venue: unique(round_id, venue_id). The same pub
//                    isn't a second stop. A CLOSED Round can't gain stops. Only a
//                    MEMBER can add a stop (you have to be out on the crawl).
//   • close        — marks closed_at. Only the creator can close. Idempotent.
//
// Reads are fail-soft (a store error → null / empty), so a Round outage renders as
// "not found" / an empty route, never a 500. Writes return a typed result the
// route maps to a status code, rather than throwing across the boundary.

import {
  cleanNewRound,
  cleanNewRoundSpend,
  cleanNewStop,
  generateRoundCode,
  normalizeRoundCode,
  resolveRoundPromotionStatus,
  type RoundDTO,
  type RoundMemberDTO,
  type RoundPriceSource,
  type RoundSpendDTO,
  type RoundSpendItemDTO,
  type RoundPromotionStatus,
  type RoundState,
  type RoundStopDTO,
} from "@/lib/rounds";
import { isDrinkCategory } from "@/lib/drinks";
import { normalizeHandle } from "@/lib/profiles";
import { admin, selectStore } from "@/lib/storeBackend";

// How many times to retry a code collision before giving up. A 6-char code over a
// 28-symbol alphabet collides so rarely that one retry would do; a handful is
// belt-and-braces and still bounded.
const CODE_MINT_ATTEMPTS = 6;

// The typed outcomes a write can produce. The route maps these to HTTP:
//   ok → 200/201, not_found → 404, closed → 409, invalid → 400, forbidden → 403.
export type RoundWriteError = "not_found" | "closed" | "invalid" | "forbidden" | "error";

export type CreateResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type JoinResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type AddStopResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type CloseResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type RecordSpendResult =
  | { ok: true; state: RoundState; created: boolean }
  | { ok: false; error: RoundWriteError };

export type TransitionSpendPromotionsResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: RoundWriteError };

export type ClaimSpendPromotionOwnerResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "forbidden" | "error" };

export type ReconcilePromotionKeysResult =
  | { ok: true; state: RoundState }
  | { ok: false; error: "not_found" | "forbidden" | "error" };

export type RoundsStore = {
  create(input: { title?: unknown; createdByHandle?: unknown }): Promise<CreateResult>;
  getByCode(code: string): Promise<RoundState | null>;
  join(code: string, handle: string): Promise<JoinResult>;
  addStop(
    code: string,
    input: { venueId?: unknown; venueName?: unknown; addedByHandle?: unknown; dropRef?: unknown },
  ): Promise<AddStopResult>;
  recordSpend(
    code: string,
    input: {
      clientRef?: unknown;
      payerHandle?: unknown;
      recordedByHandle?: unknown;
      venueId?: unknown;
      venueName?: unknown;
      totalGbp?: unknown;
      items?: unknown;
      initialPromotionStatus?: RoundPromotionStatus;
      promotionActor?: string;
    },
  ): Promise<RecordSpendResult>;
  claimSpendPromotionOwner(
    code: string,
    clientRef: string,
    actor: string,
  ): Promise<ClaimSpendPromotionOwnerResult>;
  reconcilePromotionKeys(
    code: string,
    clientRef: string,
    actor: string,
  ): Promise<ReconcilePromotionKeysResult>;
  transitionSpendPromotions(
    code: string,
    clientRef: string,
    actor: string,
    updates: ReadonlyArray<{ index: number; status: RoundPromotionStatus }>,
  ): Promise<TransitionSpendPromotionsResult>;
  close(code: string, handle: string): Promise<CloseResult>;
};

const ROUNDS = "rounds";
const MEMBERS = "round_members";
const STOPS = "round_stops";
const SPENDS = "round_spends";

// ── Row → DTO mappers (Supabase) ─────────────────────────────────────────────
function roundFromRow(row: Record<string, unknown>): RoundDTO {
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    title: String(row.title ?? ""),
    createdByHandle: String(row.created_by_handle ?? ""),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    closedAt: row.closed_at != null ? String(row.closed_at) : null,
  };
}

function memberFromRow(row: Record<string, unknown>): RoundMemberDTO {
  return {
    handle: String(row.handle ?? ""),
    joinedAt: String(row.joined_at ?? new Date(0).toISOString()),
  };
}

function stopFromRow(row: Record<string, unknown>): RoundStopDTO {
  return {
    id: String(row.id),
    venueId: String(row.venue_id ?? ""),
    venueName: String(row.venue_name ?? ""),
    addedByHandle: String(row.added_by_handle ?? ""),
    ...(row.drop_ref != null ? { dropRef: String(row.drop_ref) } : {}),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

function spendItemsFromRow(value: unknown): RoundSpendItemDTO[] {
  if (!Array.isArray(value)) return [];
  const items: RoundSpendItemDTO[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.drinkName !== "string" ||
      !isDrinkCategory(row.drinkCategory) ||
      typeof row.pricePence !== "number" ||
      !Number.isInteger(row.pricePence)
    ) {
      continue;
    }
    const source = row.source === "demo" ? "demo" : "round";
    items.push({
      drinkName: row.drinkName,
      drinkCategory: row.drinkCategory,
      pricePence: row.pricePence,
      source,
      promotionStatus: resolveRoundPromotionStatus(
        source,
        row.promotionStatus,
      ),
    });
  }
  return items;
}

function spendFromRow(row: Record<string, unknown>): RoundSpendDTO {
  return {
    id: String(row.id),
    clientRef: String(row.client_ref ?? ""),
    payerHandle: String(row.payer_handle ?? ""),
    recordedByHandle: String(row.recorded_by_handle ?? ""),
    venueId: String(row.venue_id ?? ""),
    venueName: String(row.venue_name ?? ""),
    totalPence: Number(row.total_pence ?? 0),
    items: spendItemsFromRow(row.items),
    recordedAt: String(row.recorded_at ?? new Date(0).toISOString()),
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseRoundsStore: RoundsStore = {
  async create(input) {
    const clean = cleanNewRound(input);
    if (!clean) return { ok: false, error: "invalid" };
    try {
      // Mint a unique code, retrying on the (rare) unique-violation collision.
      for (let attempt = 0; attempt < CODE_MINT_ATTEMPTS; attempt += 1) {
        const code = generateRoundCode();
        const { data, error } = await admin()
          .from(ROUNDS)
          .insert({ code, title: clean.title, created_by_handle: clean.createdByHandle })
          .select("id, code, title, created_by_handle, created_at, closed_at")
          .single();
        if (!error && data) {
          // The creator is the first member of their own Round.
          await admin()
            .from(MEMBERS)
            .insert({ round_id: (data as { id: string }).id, handle: clean.createdByHandle });
          const state = await this.getByCode(code);
          return state ? { ok: true, state } : { ok: false, error: "error" };
        }
        // 23505 = unique_violation → a code collision; retry with a new code.
        if (error && (error as { code?: string }).code !== "23505") {
          throw new Error(error.message);
        }
      }
      return { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] create failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async getByCode(code) {
    const key = normalizeRoundCode(code);
    if (!key) return null;
    try {
      const { data: roundRow, error } = await admin()
        .from(ROUNDS)
        .select("id, code, title, created_by_handle, created_at, closed_at")
        .eq("code", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!roundRow) return null;
      const round = roundFromRow(roundRow as Record<string, unknown>);

      const [{ data: memberRows }, { data: stopRows }, { data: spendRows }] = await Promise.all([
        admin().from(MEMBERS).select("handle, joined_at").eq("round_id", round.id).order("joined_at", { ascending: true }),
        admin().from(STOPS).select("id, venue_id, venue_name, added_by_handle, drop_ref, created_at").eq("round_id", round.id).order("created_at", { ascending: true }),
        admin()
          .from(SPENDS)
          .select(
            "id, client_ref, payer_handle, recorded_by_handle, venue_id, venue_name, total_pence, items, recorded_at",
          )
          .eq("round_id", round.id)
          .order("recorded_at", { ascending: true }),
      ]);
      return {
        round,
        members: (memberRows ?? []).map((r) => memberFromRow(r as Record<string, unknown>)),
        stops: (stopRows ?? []).map((r) => stopFromRow(r as Record<string, unknown>)),
        spends: (spendRows ?? []).map((r) => spendFromRow(r as Record<string, unknown>)),
      };
    } catch (err) {
      console.error("[rounds] getByCode failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async join(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      if (state.round.closedAt) return { ok: false, error: "closed" };
      // Idempotent: unique(round_id, handle) makes a re-join a no-op. upsert with
      // ignoreDuplicates so re-joining never errors.
      const { error } = await admin()
        .from(MEMBERS)
        .upsert({ round_id: state.round.id, handle: h }, { onConflict: "round_id,handle", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] join failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async addStop(code, input) {
    const clean = cleanNewStop(input);
    if (!clean) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      if (state.round.closedAt) return { ok: false, error: "closed" };
      // Only a member can add a stop — you have to be out on the crawl.
      if (!state.members.some((m) => m.handle === clean.addedByHandle)) {
        return { ok: false, error: "forbidden" };
      }
      // Idempotent on venue: unique(round_id, venue_id). The same pub isn't a
      // second stop — a re-add is silently ignored (the route re-reads state).
      const { error } = await admin()
        .from(STOPS)
        .upsert(
          {
            round_id: state.round.id,
            venue_id: clean.venueId,
            venue_name: clean.venueName,
            added_by_handle: clean.addedByHandle,
            drop_ref: clean.dropRef ?? null,
          },
          { onConflict: "round_id,venue_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] addStop failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async recordSpend(code, input) {
    const clean = cleanNewRoundSpend(input);
    if (!clean) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      if (state.round.closedAt) return { ok: false, error: "closed" };
      if (
        !state.members.some((member) => member.handle === clean.recordedByHandle) ||
        !state.members.some((member) => member.handle === clean.payerHandle)
      ) {
        return { ok: false, error: "forbidden" };
      }
      if (!state.stops.some((stop) => stop.venueId === clean.venueId)) {
        return { ok: false, error: "invalid" };
      }
      if (state.spends.some((spend) => spend.clientRef === clean.clientRef)) {
        return { ok: true, state, created: false };
      }
      const { error } = await admin().from(SPENDS).insert({
        round_id: state.round.id,
        client_ref: clean.clientRef,
        payer_handle: clean.payerHandle,
        recorded_by_handle: clean.recordedByHandle,
        venue_id: clean.venueId,
        venue_name: clean.venueName,
        total_pence: clean.totalPence,
        items: clean.items.map((item) => ({
          ...item,
          promotionStatus:
            item.source === "round"
              ? input.initialPromotionStatus ?? "diary_only"
              : "diary_only",
        })),
        promotion_actor: input.promotionActor ?? null,
      });
      if (error && (error as { code?: string }).code !== "23505") {
        throw new Error(error.message);
      }
      const next = await this.getByCode(code);
      return next
        ? { ok: true, state: next, created: !error }
        : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] recordSpend failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },

  async claimSpendPromotionOwner(code, clientRef, actor) {
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      const { data: current, error: readError } = await admin()
        .from(SPENDS)
        .select("items, promotion_actor")
        .eq("round_id", state.round.id)
        .eq("client_ref", clientRef)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!current) return { ok: false, error: "not_found" };
      const currentOwner = (current as { promotion_actor?: unknown })
        .promotion_actor;
      if (currentOwner === actor) return { ok: true };
      if (currentOwner != null) return { ok: false, error: "forbidden" };
      const promotable = spendItemsFromRow(
        (current as { items?: unknown }).items,
      ).some(
        (item) =>
          item.promotionStatus === "pending" ||
          item.promotionStatus === "ready",
      );
      if (!promotable) return { ok: false, error: "forbidden" };
      const { error: claimError } = await admin()
        .from(SPENDS)
        .update({ promotion_actor: actor })
        .eq("round_id", state.round.id)
        .eq("client_ref", clientRef)
        .is("promotion_actor", null);
      if (claimError) throw new Error(claimError.message);
      const { data, error } = await admin()
        .from(SPENDS)
        .select("promotion_actor")
        .eq("round_id", state.round.id)
        .eq("client_ref", clientRef)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { ok: false, error: "not_found" };
      return (data as { promotion_actor?: unknown }).promotion_actor === actor
        ? { ok: true }
        : { ok: false, error: "forbidden" };
    } catch (err) {
      console.error(
        "[rounds] claimSpendPromotionOwner failed:",
        err instanceof Error ? err.message : err,
      );
      return { ok: false, error: "error" };
    }
  },

  async reconcilePromotionKeys(code, clientRef, actor) {
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      const spend = state.spends.find(
        (candidate) => candidate.clientRef === clientRef,
      );
      if (!spend) return { ok: false, error: "not_found" };
      const { data, error } = await admin().rpc(
        "reconcile_round_price_keys",
        {
          p_actor: actor,
          p_spend_id: spend.id,
        },
      );
      if (error) throw new Error(error.message);
      if (data === "forbidden") return { ok: false, error: "forbidden" };
      if (data === "not_found") return { ok: false, error: "not_found" };
      if (data !== "ok") return { ok: false, error: "error" };
      const next = await this.getByCode(code);
      return next
        ? { ok: true, state: next }
        : { ok: false, error: "error" };
    } catch (err) {
      console.error(
        "[rounds] reconcilePromotionKeys failed:",
        err instanceof Error ? err.message : err,
      );
      return { ok: false, error: "error" };
    }
  },

  async transitionSpendPromotions(code, clientRef, actor, updates) {
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      const spend = state.spends.find((candidate) => candidate.clientRef === clientRef);
      if (!spend) return { ok: false, error: "not_found" };
      const { data, error } = await admin().rpc(
        "transition_round_price_lines",
        {
          p_actor: actor,
          p_spend_id: spend.id,
          p_updates: updates,
        },
      );
      if (error) throw new Error(error.message);
      if (data === "forbidden") return { ok: false, error: "forbidden" };
      if (data === "not_found") return { ok: false, error: "not_found" };
      if (data !== "ok") return { ok: false, error: "error" };
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error(
        "[rounds] transitionSpendPromotions failed:",
        err instanceof Error ? err.message : err,
      );
      return { ok: false, error: "error" };
    }
  },

  async close(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    try {
      const state = await this.getByCode(code);
      if (!state) return { ok: false, error: "not_found" };
      // Only the creator can close. Idempotent — closing a closed Round is fine.
      if (state.round.createdByHandle !== h) return { ok: false, error: "forbidden" };
      if (!state.round.closedAt) {
        const { error } = await admin()
          .from(ROUNDS)
          .update({ closed_at: new Date().toISOString() })
          .eq("id", state.round.id);
        if (error) throw new Error(error.message);
      }
      const next = await this.getByCode(code);
      return next ? { ok: true, state: next } : { ok: false, error: "error" };
    } catch (err) {
      console.error("[rounds] close failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "error" };
    }
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Keyed by canonical code, resets on restart — right for dev/demo/test.
type MemoryRound = {
  id: string;
  code: string;
  title: string;
  createdByHandle: string;
  createdAt: string;
  closedAt: string | null;
  members: RoundMemberDTO[];
  stops: RoundStopDTO[];
  spends: RoundSpendDTO[];
  promotionOwners: Map<string, string>;
};

const memoryRounds = new Map<string, MemoryRound>();
let memorySeq = 0;

function stamp(): string {
  // Distinct, monotonic timestamps so insert-order sorting is stable even when
  // two writes land in the same millisecond.
  return new Date(Date.now() + memorySeq).toISOString();
}

function stateFrom(round: MemoryRound): RoundState {
  return {
    round: {
      id: round.id,
      code: round.code,
      title: round.title,
      createdByHandle: round.createdByHandle,
      createdAt: round.createdAt,
      closedAt: round.closedAt,
    },
    members: round.members.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    stops: round.stops.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    spends: round.spends.slice().sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
  };
}

export const memoryRoundsStore: RoundsStore = {
  async create(input) {
    const clean = cleanNewRound(input);
    if (!clean) return { ok: false, error: "invalid" };
    let code = generateRoundCode();
    for (let attempt = 0; memoryRounds.has(code) && attempt < CODE_MINT_ATTEMPTS; attempt += 1) {
      code = generateRoundCode();
    }
    if (memoryRounds.has(code)) return { ok: false, error: "error" };
    memorySeq += 1;
    const round: MemoryRound = {
      id: `r${memorySeq}`,
      code,
      title: clean.title,
      createdByHandle: clean.createdByHandle,
      createdAt: stamp(),
      closedAt: null,
      // The creator is the first member of their own Round.
      members: [{ handle: clean.createdByHandle, joinedAt: stamp() }],
      stops: [],
      spends: [],
      promotionOwners: new Map(),
    };
    memoryRounds.set(code, round);
    return { ok: true, state: stateFrom(round) };
  },

  async getByCode(code) {
    const key = normalizeRoundCode(code);
    if (!key) return null;
    const round = memoryRounds.get(key);
    return round ? stateFrom(round) : null;
  },

  async join(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.closedAt) return { ok: false, error: "closed" };
    if (!round.members.some((m) => m.handle === h)) {
      memorySeq += 1;
      round.members.push({ handle: h, joinedAt: stamp() });
    }
    return { ok: true, state: stateFrom(round) };
  },

  async addStop(code, input) {
    const clean = cleanNewStop(input);
    if (!clean) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.closedAt) return { ok: false, error: "closed" };
    if (!round.members.some((m) => m.handle === clean.addedByHandle)) {
      return { ok: false, error: "forbidden" };
    }
    // Idempotent on venue — the same pub isn't a second stop.
    if (!round.stops.some((s) => s.venueId === clean.venueId)) {
      memorySeq += 1;
      round.stops.push({
        id: `s${memorySeq}`,
        venueId: clean.venueId,
        venueName: clean.venueName,
        addedByHandle: clean.addedByHandle,
        ...(clean.dropRef ? { dropRef: clean.dropRef } : {}),
        createdAt: stamp(),
      });
    }
    return { ok: true, state: stateFrom(round) };
  },

  async recordSpend(code, input) {
    const clean = cleanNewRoundSpend(input);
    if (!clean) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.closedAt) return { ok: false, error: "closed" };
    if (
      !round.members.some((member) => member.handle === clean.recordedByHandle) ||
      !round.members.some((member) => member.handle === clean.payerHandle)
    ) {
      return { ok: false, error: "forbidden" };
    }
    if (!round.stops.some((stop) => stop.venueId === clean.venueId)) {
      return { ok: false, error: "invalid" };
    }
    const created = !round.spends.some((spend) => spend.clientRef === clean.clientRef);
    if (created) {
      memorySeq += 1;
      round.spends.push({
        id: `spend${memorySeq}`,
        clientRef: clean.clientRef,
        payerHandle: clean.payerHandle,
        recordedByHandle: clean.recordedByHandle,
        venueId: clean.venueId,
        venueName: clean.venueName,
        totalPence: clean.totalPence,
        items: clean.items.map((item) => ({
          ...item,
          promotionStatus:
            item.source === "round"
              ? input.initialPromotionStatus ?? "diary_only"
              : "diary_only",
        })),
        recordedAt: stamp(),
      });
      if (input.promotionActor) {
        round.promotionOwners.set(clean.clientRef, input.promotionActor);
      }
    } else if (input.promotionActor) {
      const currentOwner = round.promotionOwners.get(clean.clientRef);
      if (currentOwner && currentOwner !== input.promotionActor) {
        return { ok: false, error: "forbidden" };
      }
    }
    return { ok: true, state: stateFrom(round), created };
  },

  async claimSpendPromotionOwner(code, clientRef, actor) {
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (!round.spends.some((spend) => spend.clientRef === clientRef)) {
      return { ok: false, error: "not_found" };
    }
    const current = round.promotionOwners.get(clientRef);
    if (current && current !== actor) {
      return { ok: false, error: "forbidden" };
    }
    const spend = round.spends.find(
      (candidate) => candidate.clientRef === clientRef,
    );
    if (
      !current &&
      !spend?.items.some(
        (item) =>
          item.promotionStatus === "pending" ||
          item.promotionStatus === "ready",
      )
    ) {
      return { ok: false, error: "forbidden" };
    }
    round.promotionOwners.set(clientRef, actor);
    return { ok: true };
  },

  async reconcilePromotionKeys(code, clientRef, actor) {
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (!round.spends.some((spend) => spend.clientRef === clientRef)) {
      return { ok: false, error: "not_found" };
    }
    if (round.promotionOwners.get(clientRef) !== actor) {
      return { ok: false, error: "forbidden" };
    }

    const owners = new Map<
      string,
      { spend: RoundSpendDTO; index: number }
    >();
    for (const spend of round.spends) {
      if (round.promotionOwners.get(spend.clientRef) !== actor) continue;
      spend.items.forEach((item, index) => {
        if (
          item.source !== "round" ||
          (item.promotionStatus !== "pending" &&
            item.promotionStatus !== "ready")
        ) {
          return;
        }
        owners.set(`${spend.venueId}:${item.drinkCategory}`, { spend, index });
      });
    }
    for (const spend of round.spends) {
      if (round.promotionOwners.get(spend.clientRef) !== actor) continue;
      spend.items.forEach((item, index) => {
        if (
          item.source !== "round" ||
          (item.promotionStatus !== "pending" &&
            item.promotionStatus !== "ready")
        ) {
          return;
        }
        const owner = owners.get(`${spend.venueId}:${item.drinkCategory}`);
        if (owner?.spend !== spend || owner.index !== index) {
          item.promotionStatus = "superseded";
        }
      });
    }
    return { ok: true, state: stateFrom(round) };
  },

  async transitionSpendPromotions(code, clientRef, actor, updates) {
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    const spend = round.spends.find((candidate) => candidate.clientRef === clientRef);
    if (!spend) return { ok: false, error: "not_found" };
    if (round.promotionOwners.get(clientRef) !== actor) {
      return { ok: false, error: "forbidden" };
    }
    const reconciled = await this.reconcilePromotionKeys(code, clientRef, actor);
    if (!reconciled.ok) return reconciled;
    for (const update of updates) {
      const item = spend.items[update.index];
      if (!item || item.source !== "round") continue;
      if (
        update.status === "ready" &&
        item.promotionStatus === "pending"
      ) {
        item.promotionStatus = "ready";
      } else if (
        update.status === "promoted" &&
        item.promotionStatus === "ready"
      ) {
        item.promotionStatus = update.status;
      } else if (
        update.status === "superseded" &&
        (item.promotionStatus === "pending" ||
          item.promotionStatus === "ready" ||
          item.promotionStatus === "promoted")
      ) {
        item.promotionStatus = "superseded";
      }
    }
    return { ok: true, state: stateFrom(round) };
  },

  async close(code, handle) {
    const h = normalizeHandle(handle);
    if (!h) return { ok: false, error: "invalid" };
    const round = memoryRounds.get(normalizeRoundCode(code));
    if (!round) return { ok: false, error: "not_found" };
    if (round.createdByHandle !== h) return { ok: false, error: "forbidden" };
    if (!round.closedAt) round.closedAt = stamp();
    return { ok: true, state: stateFrom(round) };
  },
};

/** The single backend selection point (mirrors the other stores). */
export function roundsStore(): RoundsStore {
  return selectStore(memoryRoundsStore, supabaseRoundsStore);
}

export function markRoundPriceSourceSuperseded(
  source: RoundPriceSource,
  actor: string,
): void {
  markRoundPriceSourceStatus(source, actor, "superseded");
}

export function markRoundPriceSourcePromoted(
  source: RoundPriceSource,
  actor: string,
): void {
  markRoundPriceSourceStatus(source, actor, "promoted");
}

export function roundPriceSourceStatus(
  source: RoundPriceSource,
  actor: string,
  venueId: string,
  drinkCategory: string,
): "ready" | "promoted" | null {
  for (const round of memoryRounds.values()) {
    const sourceSpend = round.spends.find(
      (candidate) => candidate.id === source.spendId,
    );
    if (!sourceSpend) continue;
    const sourceItem = sourceSpend.items[source.lineIndex];
    if (
      round.promotionOwners.get(sourceSpend.clientRef) !== actor ||
      sourceSpend.venueId !== venueId ||
      sourceItem?.source !== "round" ||
      sourceItem.drinkCategory !== drinkCategory
    ) {
      return null;
    }
    if (sourceItem.promotionStatus === "promoted") return "promoted";
    if (sourceItem.promotionStatus !== "ready") return null;

    let current:
      | { spend: RoundSpendDTO; lineIndex: number }
      | undefined;
    for (const spend of round.spends) {
      if (
        round.promotionOwners.get(spend.clientRef) !== actor ||
        spend.venueId !== venueId
      ) {
        continue;
      }
      spend.items.forEach((item, lineIndex) => {
        if (
          item.source === "round" &&
          item.drinkCategory === drinkCategory &&
          (item.promotionStatus === "pending" ||
            item.promotionStatus === "ready")
        ) {
          current = { spend, lineIndex };
        }
      });
    }
    return current?.spend === sourceSpend &&
      current?.lineIndex === source.lineIndex
      ? "ready"
      : null;
  }
  return null;
}

function markRoundPriceSourceStatus(
  source: RoundPriceSource,
  actor: string,
  status: "promoted" | "superseded",
): void {
  for (const round of memoryRounds.values()) {
    const spend = round.spends.find((candidate) => candidate.id === source.spendId);
    if (!spend) continue;
    if (round.promotionOwners.get(spend.clientRef) !== actor) return;
    const item = spend.items[source.lineIndex];
    if (
      item?.source === "round" &&
      (status === "superseded" ||
        item.promotionStatus === "ready" ||
        item.promotionStatus === "promoted")
    ) {
      item.promotionStatus = status;
    }
    return;
  }
}

/** Test-only: clear the in-memory Round map between cases. */
export function __resetMemoryRounds(): void {
  memoryRounds.clear();
  memorySeq = 0;
}
