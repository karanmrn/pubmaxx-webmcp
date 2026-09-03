export type SupabaseConfig = Readonly<{
  url: string;
  key: string;
}>;

export type SupabaseConfigOptions = Readonly<{
  requireHttps?: boolean;
  expectedKeyRole?: SupabaseKeyRole;
  allowUnknownKeyRole?: boolean;
}>;

export type SupabaseKeyRole = "publishable" | "secret";

function legacyJwtRole(key: string): SupabaseKeyRole | null {
  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== "object" || !("role" in payload)) return null;
    if (payload.role === "anon") return "publishable";
    if (payload.role === "service_role") return "secret";
  } catch {
    return null;
  }

  return null;
}

function supabaseKeyRole(key: string): SupabaseKeyRole | null {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  return legacyJwtRole(key);
}

export function resolveSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
  options: SupabaseConfigOptions = {},
): SupabaseConfig | null {
  const cleanUrl = url?.trim();
  const cleanKey = key?.trim();
  if (!cleanUrl || !cleanKey) return null;
  if (!/^https?:\/\//i.test(cleanUrl)) return null;

  if (options.expectedKeyRole) {
    const keyRole = supabaseKeyRole(cleanKey);
    if (keyRole && keyRole !== options.expectedKeyRole) return null;
    if (!keyRole && options.allowUnknownKeyRole === false) return null;
  }

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (options.requireHttps && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { url: cleanUrl, key: cleanKey };
}
