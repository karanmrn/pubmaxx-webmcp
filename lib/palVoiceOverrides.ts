import type { PubPal, PubPalVoiceId } from "@/lib/pubPal";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";

export type PalVoiceOverrides = {
  voiceId: string | null;
  firstMessage: string;
  systemPrompt: string;
};

const VOICE_ENV_KEYS: Record<PubPalVoiceId, string> = {
  ember: "ELEVENLABS_VOICE_EMBER",
  velvet: "ELEVENLABS_VOICE_VELVET",
  signal: "ELEVENLABS_VOICE_SIGNAL",
};

/** SafeNightStrip register for get-home topics: plain, one fact per sentence, zero jokes. */
export const PAL_VOICE_GET_HOME_REGISTER_INTRO =
  "When the night turns to getting home, last trains, rides, sobriety, or having one more drink, switch to the Safe Night register.";

export const PAL_VOICE_GET_HOME_REGISTER_RULES = [
  "Use plain sentences. One fact per sentence. No jokes, no banter, no playful lines.",
  "Never assess whether the user is sober enough to drink or travel.",
  "Never say they are fine for another drink or guarantee any outcome.",
  "Name last train times, TfL journey planning, and ride handoff options only from grounded data the app shows.",
  "Point them to the Getting Home tab on the venue sheet for live trains, rides, and the calm safety strip.",
  "Refuse to freestyle get-home decisions. Offer facts, then hand off to Getting Home.",
] as const;

export const PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE =
  "You may propose a fact or plan change, but never apply it yourself. Say what you would save and ask the user to confirm in the app before it counts.";

const SESSION_CAP_RULE =
  `End the call with end_call once the chat reaches ${PAL_VOICE_MAX_SESSION_SECONDS} seconds or the user is done. Do not run past that cap.`;

export function resolveElevenLabsVoiceId(voiceId: PubPalVoiceId): string | null {
  const envKey = VOICE_ENV_KEYS[voiceId];
  const value = process.env[envKey]?.trim();
  return value || null;
}

function relationshipTone(relationship: PubPal["personality"]["relationship"]): string {
  if (relationship === "guide") return "Measured and clear. Lead with the useful fact.";
  if (relationship === "confidant") return "Warm and discreet. Keep the night low-drama.";
  return "Upbeat and practical. Sound like a mate who knows the map.";
}

function speciesNote(species: PubPal["appearance"]["species"]): string {
  const notes: Partial<Record<PubPal["appearance"]["species"], string>> = {
    robin: "The circuit robin who reads the room.",
    greyhound: "A loyal greyhound who reads the room.",
    cat: "A black cat with dry wit off the get-home topics.",
    fox: "A quick fox who spots the sensible exit.",
    pigeon: "A streetwise pigeon who knows the last buses.",
    badger: "A steady badger who keeps the group grounded.",
    corgi: "A bright corgi who cheers the plan without pushing another pint.",
  };
  return notes[species] ?? "A Pub Pal who knows London nights.";
}

function sliderHints(pal: PubPal): string {
  const { playfulness, energy, storytelling } = pal.personality;
  const hints: string[] = [];
  if (playfulness >= 70) hints.push("A little playful on pub picks and trivia.");
  else if (playfulness <= 35) hints.push("Keep humour spare.");
  if (energy >= 70) hints.push("Pace is brisk.");
  else if (energy <= 35) hints.push("Pace is unhurried.");
  if (storytelling >= 70) hints.push("Short stories are welcome when they help the night.");
  else hints.push("Favour short answers.");
  return hints.join(" ");
}

export function buildPalVoiceFirstMessage(pal: PubPal): string {
  return `Hi, I'm ${pal.name}. What kind of night are you planning?`;
}

export function buildPalVoiceSystemPrompt(pal: PubPal): string {
  const lines = [
    `You are ${pal.name}, a Pub Pal on PUBMAXX. ${speciesNote(pal.appearance.species)}`,
    relationshipTone(pal.personality.relationship),
    sliderHints(pal),
    "British spelling. No exclamation marks. No em dashes.",
    PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE,
    SESSION_CAP_RULE,
    PAL_VOICE_GET_HOME_REGISTER_INTRO,
    ...PAL_VOICE_GET_HOME_REGISTER_RULES,
    "Outside get-home topics you may be dry and warm, but never beside a price, date, or safety claim.",
  ];
  return lines.join("\n");
}

export function buildPalVoiceOverrides(pal: PubPal): PalVoiceOverrides {
  return {
    voiceId: resolveElevenLabsVoiceId(pal.voice.id),
    firstMessage: buildPalVoiceFirstMessage(pal),
    systemPrompt: buildPalVoiceSystemPrompt(pal),
  };
}
