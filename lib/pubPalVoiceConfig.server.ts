import "server-only";

/** Whether both server-side provider credentials are present for this deploy. */
export function palVoiceConfigured(): boolean {
  return Boolean(
    process.env.ELEVENLABS_API_KEY?.trim() &&
      process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim(),
  );
}
