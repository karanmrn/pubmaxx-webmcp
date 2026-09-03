// Where the device copy of a Night Profile came from.
//
// A Night Profile saved on this device is the drinker's own, and it survives
// signing out - that is the point of "Saved on this device". A copy MIRRORED
// off an account is a different thing wearing the same label: it is that
// account's answer, so it may not follow the browser into someone else's
// session. The provenance stamp is what lets `lib/deviceAccountIdentity.ts`
// tell the two apart without guessing at the contents.
//
// The key lives here, beside the stamp, so both readers share one owner.

export const NIGHT_PROFILE_DEVICE_KEY = "pubmaxx.night-profile.v1:device";

export type NightProfileDeviceSource = "account" | "device";

/**
 * The stamp on the stored device copy, or null when there is none. An envelope
 * written before this stamp existed reads as "device": it was typed on this
 * device by whoever was here, and a mirrored copy is the narrower claim.
 */
export function readDeviceNightProfileProvenance(
  storage: Pick<Storage, "getItem"> | null,
): NightProfileDeviceSource | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(NIGHT_PROFILE_DEVICE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed.source === "account" ? "account" : "device";
  } catch {
    return null;
  }
}
