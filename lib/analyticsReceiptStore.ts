import "server-only";

import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

export type AnalyticsReceiptClaim = "claimed" | "delivered" | "busy" | "conflict" | "error";

export type AnalyticsReceiptStore = {
  claim(input: { eventId: string; tokenDigest: string; eventName: string; now?: Date }): Promise<AnalyticsReceiptClaim>;
  complete(eventId: string, now?: Date): Promise<boolean>;
};

type MemoryReceipt = {
  tokenDigest: string;
  eventName: string;
  status: "pending" | "delivered";
  leaseUntil: number;
};

const memoryGlobal = globalThis as typeof globalThis & {
  __pubmaxAnalyticsReceipts?: Map<string, MemoryReceipt>;
};
const memoryReceipts = memoryGlobal.__pubmaxAnalyticsReceipts ??= new Map<string, MemoryReceipt>();
const LEASE_MS = 5_000;

export const memoryAnalyticsReceiptStore: AnalyticsReceiptStore = {
  async claim(input) {
    const now = (input.now ?? new Date()).getTime();
    const existing = memoryReceipts.get(input.eventId);
    if (existing) {
      if (existing.tokenDigest !== input.tokenDigest || existing.eventName !== input.eventName) return "conflict";
      if (existing.status === "delivered") return "delivered";
      if (existing.leaseUntil > now) return "busy";
      existing.leaseUntil = now + LEASE_MS;
      return "claimed";
    }
    memoryReceipts.set(input.eventId, {
      tokenDigest: input.tokenDigest,
      eventName: input.eventName,
      status: "pending",
      leaseUntil: now + LEASE_MS,
    });
    return "claimed";
  },
  async complete(eventId, now = new Date()) {
    const receipt = memoryReceipts.get(eventId);
    if (!receipt) return false;
    receipt.status = "delivered";
    receipt.leaseUntil = now.getTime();
    return true;
  },
};

export const supabaseAnalyticsReceiptStore: AnalyticsReceiptStore = {
  async claim(input) {
    try {
      const now = input.now ?? new Date();
      const { data, error } = await requireSupabaseAdmin().rpc("claim_analytics_event_receipt", {
        p_event_id: input.eventId,
        p_token_hash: input.tokenDigest,
        p_event_name: input.eventName,
        p_now: now.toISOString(),
        p_lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
      });
      if (error) return "error";
      return ["claimed", "delivered", "busy", "conflict"].includes(data) ? data as AnalyticsReceiptClaim : "error";
    } catch {
      return "error";
    }
  },
  async complete(eventId, now = new Date()) {
    try {
      const { data, error } = await requireSupabaseAdmin().rpc("complete_analytics_event_receipt", {
        p_event_id: eventId,
        p_delivered_at: now.toISOString(),
      });
      return !error && data === true;
    } catch {
      return false;
    }
  },
};

export function analyticsReceiptStore(): AnalyticsReceiptStore {
  return isSupabaseConfigured() ? supabaseAnalyticsReceiptStore : memoryAnalyticsReceiptStore;
}

export function __resetMemoryAnalyticsReceipts(): void {
  memoryReceipts.clear();
}
