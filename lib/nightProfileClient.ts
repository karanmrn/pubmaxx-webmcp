import {
  cleanNightProfileInput,
  DEFAULT_NIGHT_PROFILE_INPUT,
  nightProfileInput,
  NIGHT_PROFILE_VERSION,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";
import type { CityId } from "@/lib/cities";
import type { NightContext } from "@/lib/nightPlanning";
import {
  NIGHT_PROFILE_DEVICE_KEY,
  type NightProfileDeviceSource,
} from "@/lib/nightProfileDeviceProvenance";

export {
  NIGHT_PROFILE_DEVICE_KEY,
  type NightProfileDeviceSource,
} from "@/lib/nightProfileDeviceProvenance";
export const NIGHT_PROFILE_DEVICE_CHANGED_EVENT = "pubmax:night-profile-device-changed";

type StoredNightProfileDraft = {
  version: typeof NIGHT_PROFILE_VERSION;
  profile: NightProfileInput;
  /** Whether this copy was typed here or mirrored off an account. */
  source: NightProfileDeviceSource;
};

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDeviceNightProfile(storage = browserStorage()): NightProfileInput | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(NIGHT_PROFILE_DEVICE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Partial<StoredNightProfileDraft>;
    if (envelope.version !== NIGHT_PROFILE_VERSION) return null;
    return cleanNightProfileInput(envelope.profile);
  } catch {
    return null;
  }
}

export function writeDeviceNightProfile(
  profile: NightProfileInput,
  storage = browserStorage(),
  source: NightProfileDeviceSource = "device",
): boolean {
  if (!storage) return false;
  const clean = cleanNightProfileInput(profile);
  if (!clean) return false;
  try {
    storage.setItem(
      NIGHT_PROFILE_DEVICE_KEY,
      JSON.stringify({
        version: NIGHT_PROFILE_VERSION,
        profile: clean,
        source,
      } satisfies StoredNightProfileDraft),
    );
    if (typeof window !== "undefined" && storage === window.localStorage) {
      window.dispatchEvent(new Event(NIGHT_PROFILE_DEVICE_CHANGED_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}

/** Mirror a loaded account Night Profile onto this device for signed-out continuity. */
export function mirrorAccountNightProfileToDevice(
  account: NightProfile | null,
  storage = browserStorage(),
): NightProfileInput | null {
  if (!account) return null;
  const input = nightProfileInput(account);
  // Stamped "account": this copy is the account's answer, so an account change
  // takes it with it (lib/deviceAccountIdentity.ts).
  if (!writeDeviceNightProfile(input, storage, "account")) return null;
  return input;
}

export function clearDeviceNightProfile(storage = browserStorage()): void {
  try {
    storage?.removeItem(NIGHT_PROFILE_DEVICE_KEY);
    if (typeof window !== "undefined" && storage === window.localStorage) {
      window.dispatchEvent(new Event(NIGHT_PROFILE_DEVICE_CHANGED_EVENT));
    }
  } catch {
    // Storage is best effort; a failed clear must not erase the server profile.
  }
}

/**
 * Persists only the validated planning context and optional public city id.
 * NightContext has no coordinates or voice transcript fields, so callers
 * cannot accidentally turn a planning edit into location or speech history.
 */
export function writeDeviceNightContext(
  context: NightContext,
  cityId?: CityId,
  storage = browserStorage(),
): NightProfileInput | null {
  const current = readDeviceNightProfile(storage) ?? DEFAULT_NIGHT_PROFILE_INPUT;
  const next = cleanNightProfileInput({
    ...current,
    ...(cityId ? { cityId } : {}),
    context,
  });
  if (!next || !writeDeviceNightProfile(next, storage)) return null;
  return next;
}

export type NightProfileMergeState =
  | { kind: "none" }
  | { kind: "device-only"; device: NightProfileInput }
  | { kind: "conflict"; device: NightProfileInput; account: NightProfile };

/**
 * Detection only. It never picks a winner: importing device preferences is a
 * consequential account write and always requires an explicit UI choice.
 */
export function nightProfileMergeState(
  device: NightProfileInput | null,
  account: NightProfile | null,
): NightProfileMergeState {
  if (!device) return { kind: "none" };
  if (!account) return { kind: "device-only", device };
  const accountInput = nightProfileInput(account);
  return JSON.stringify(device) === JSON.stringify(accountInput)
    ? { kind: "none" }
    : { kind: "conflict", device, account };
}

export type NightProfileMergeChoice = "bring-device" | "keep-account";

export function confirmedNightProfileMerge(
  state: Exclude<NightProfileMergeState, { kind: "none" }>,
  choice: NightProfileMergeChoice,
): { profile: NightProfileInput; expectedUpdatedAt: string | null; writesAccount: boolean } {
  if (choice === "keep-account" && state.kind === "conflict") {
    return {
      profile: nightProfileInput(state.account),
      expectedUpdatedAt: state.account.updatedAt,
      writesAccount: false,
    };
  }
  if (choice === "keep-account") {
    // With no account row, "start fresh" means retain the local draft until
    // the person edits/saves it; it must not create an account row silently.
    return { profile: state.device, expectedUpdatedAt: null, writesAccount: false };
  }
  return {
    profile: state.device,
    expectedUpdatedAt: state.kind === "conflict" ? state.account.updatedAt : null,
    writesAccount: true,
  };
}

export function subscribeDeviceNightProfile(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === NIGHT_PROFILE_DEVICE_KEY) {
      listener();
    }
  };
  const onChanged = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(NIGHT_PROFILE_DEVICE_CHANGED_EVENT, onChanged);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(NIGHT_PROFILE_DEVICE_CHANGED_EVENT, onChanged);
  };
}
