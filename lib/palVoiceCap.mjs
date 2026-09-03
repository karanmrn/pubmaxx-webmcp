// The one Pub Pal live voice session cap, in whole seconds.
//
// The provisioner, the browser timer and the billing clamp must all read this
// file. Two copies (300 in the ElevenLabs script, 180 in the app) left the
// provider socket open for two unbilled minutes after the product had ended.

export const PAL_VOICE_MAX_SESSION_SECONDS = 180;
