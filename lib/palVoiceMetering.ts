import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceCap.mjs";

export { PAL_VOICE_MAX_SESSION_SECONDS };

/** Monthly voice allowance in whole minutes (keyless and Supabase). */
export const PAL_VOICE_MONTHLY_MINUTES = 30;

export type PalVoiceMeterState = {
  month: string;
  usedMinutes: number;
  reservations: number;
};

export function remainingVoiceMinutes(meter: PalVoiceMeterState): number {
  return Math.max(0, PAL_VOICE_MONTHLY_MINUTES - meter.usedMinutes);
}

export function billableVoiceMinutes(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.max(1, Math.ceil(durationSeconds / 60));
}

export function canReserveVoiceMinute(meter: PalVoiceMeterState): boolean {
  return meter.reservations < 1 && meter.usedMinutes < PAL_VOICE_MONTHLY_MINUTES;
}
