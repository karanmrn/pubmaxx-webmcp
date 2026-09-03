type StoredMutationKey = { version: 1; key: string; fingerprint: string };

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function persistentPlanMutationKey(scope: string, value: unknown): Promise<string> {
  const storageKey = `pubmaxx:plan-mutation:v1:${scope}`;
  const nextFingerprint = await fingerprint(value);
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as StoredMutationKey | null;
    if (parsed?.version === 1 && parsed.fingerprint === nextFingerprint && typeof parsed.key === "string") return parsed.key;
  } catch { /* replace malformed or unavailable state */ }
  const key = `${scope}-${crypto.randomUUID()}`.slice(0, 120);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, key, fingerprint: nextFingerprint } satisfies StoredMutationKey));
  } catch { /* the in-memory key still protects this attempt */ }
  return key;
}

export function clearPersistentPlanMutationKey(scope: string, key: string): void {
  const storageKey = `pubmaxx:plan-mutation:v1:${scope}`;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as StoredMutationKey | null;
    if (parsed?.version === 1 && parsed.key === key) sessionStorage.removeItem(storageKey);
  } catch { /* best effort */ }
}
