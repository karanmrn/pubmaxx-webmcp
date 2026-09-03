// Identity-free push registry for the Capacitor shell and installed web app.
// ONE interface, TWO storage implementations (process-memory + Supabase
// public.push_tokens), same seam pattern as the other stores. A row is keyed by
// its opaque native token / serialized web subscription; re-registration is an
// idempotent last_seen_at refresh.
//
// No auth: native registration happens before sign-in and web registration only
// after explicit browser permission, but neither carries identity. A row means
// only "this device/browser can receive public pushes".

import { admin, selectStore } from "@/lib/storeBackend";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

export type PushPlatform = "ios" | "android" | "web";

export type PushTokenDTO = {
  token: string;
  platform: PushPlatform;
  createdAt: string;
  lastSeenAt: string;
};

export type PushTokenInput = { token: string; platform: PushPlatform };

export type PushTokenValidation =
  | { ok: true; input: PushTokenInput }
  | { ok: false; error: string };

export const MAX_TOKEN_LENGTH = 2_048;

/** Validate an untrusted { token, platform } payload from the shell. */
export function validatePushToken(raw: {
  token?: unknown;
  platform?: unknown;
}): PushTokenValidation {
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!token) return { ok: false, error: "Device token is missing." };
  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: `Token is too long (max ${MAX_TOKEN_LENGTH} characters).` };
  }
  const platform = raw.platform;
  if (platform !== "ios" && platform !== "android" && platform !== "web") {
    return { ok: false, error: "Platform must be ios, android or web." };
  }
  if (platform === "web" && !decodeWebPushSubscription(token)) {
    return { ok: false, error: "Web token must contain a valid push subscription." };
  }
  if (platform !== "web" && decodeWebPushSubscription(token)) {
    return { ok: false, error: "Web push subscriptions must use the web platform." };
  }
  return { ok: true, input: { token, platform } };
}

export type PushTokenStore = {
  /** Register (or refresh) a device token. Idempotent per token. */
  save(input: PushTokenInput): Promise<PushTokenDTO>;
  /** All registered device tokens. The send fan-out (lib/pushSender.ts) reads
   *  this to resolve broadcast targets. Rows carry no identity, so this is the
   *  ONLY targeting available until tokens gain identity — see pushSender. */
  list(): Promise<PushTokenDTO[]>;
  /** Remove a token the push provider reported invalid (APNs 410 /
   *  BadDeviceToken). Idempotent — deleting an absent token is a no-op. */
  delete(token: string): Promise<void>;
};

const TABLE = "push_tokens";

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabasePushTokenStore: PushTokenStore = {
  async save(input) {
    const now = new Date().toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .upsert(
        { token: input.token, platform: input.platform, last_seen_at: now },
        { onConflict: "token" },
      )
      .select("token, platform, created_at, last_seen_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      token: String(data.token),
      platform: data.platform === "web" ? "web" : data.platform === "android" ? "android" : "ios",
      createdAt: String(data.created_at),
      lastSeenAt: String(data.last_seen_at),
    };
  },
  async list() {
    const { data, error } = await admin()
      .from(TABLE)
      .select("token, platform, created_at, last_seen_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      token: String(row.token),
      platform: row.platform === "web" ? "web" : row.platform === "android" ? "android" : "ios",
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
    }));
  },
  async delete(token) {
    const { error } = await admin().from(TABLE).delete().eq("token", token);
    if (error) throw new Error(error.message);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
const memoryTokens = new Map<string, PushTokenDTO>();

export const memoryPushTokenStore: PushTokenStore = {
  async save(input) {
    const now = new Date().toISOString();
    const existing = memoryTokens.get(input.token);
    const dto: PushTokenDTO = {
      token: input.token,
      platform: input.platform,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    memoryTokens.set(input.token, dto);
    return dto;
  },
  async list() {
    return [...memoryTokens.values()];
  },
  async delete(token) {
    memoryTokens.delete(token);
  },
};

/** The single backend selection point (mirrors the other stores). */
export function pushTokenStore(): PushTokenStore {
  return selectStore(memoryPushTokenStore, supabasePushTokenStore);
}

/** Test-only: current in-memory registrations (insertion order). */
export function __listMemoryPushTokens(): PushTokenDTO[] {
  return [...memoryTokens.values()];
}

/** Test-only: clear the in-memory registry between cases. */
export function __resetMemoryPushTokens(): void {
  memoryTokens.clear();
}
