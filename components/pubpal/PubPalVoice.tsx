"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Send } from "lucide-react";

import { discardBody } from "@/lib/responseBody";
import type { PalAnimationState } from "@/lib/pubPal";

// The session half carries the ElevenLabs SDK, so it is fetched when the probe
// says voice is on and never before. ssr:false because there is nothing to
// render on the server for a control that needs a microphone.
const PubPalVoiceSession = dynamic(
  () => import("@/components/pubpal/PubPalVoiceSession"),
  {
    ssr: false,
    loading: () => (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          Warming up voice
        </div>
      </div>
    ),
  },
);

// Voice is switched on per deployment by the captain's ElevenLabs keys (see
// docs/PUB_PAL_SETUP.md). Until they are set, the Pal SAYS so in its own voice
// and points at the writing door - a Start button that answers 503 on the tap
// reads as a broken feature rather than one nobody has turned on. Availability
// is TRI-STATE: while the answer is still coming the control renders neither
// claim, because "voice is off" is a statement we must have checked.
export type PalVoiceAvailability = "asking" | "available" | "unavailable";

export const PAL_VOICE_UNAVAILABLE_LINE =
  "Voice is not switched on here yet. Ask me in writing and you get the same grounded answers.";
const PAL_VOICE_MUTED_LINE =
  "Voice is muted. Ask me in writing or turn voice back on when you want it.";

/**
 * Read the probe's answer.
 *
 * Anything short of an explicit `available: true` is treated as off. That is
 * the safe half here and only here: the two states differ by which door the
 * Pal offers, and offering the writing door when voice was in fact available
 * costs a tap, while offering a Start button that answers 503 reads as broken.
 */
export function palVoiceAvailabilityFrom(
  ok: boolean,
  body: unknown,
): PalVoiceAvailability {
  if (!ok) return "unavailable";
  const available =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { available?: unknown }).available
      : undefined;
  return available === true ? "available" : "unavailable";
}

/** The voice-off card: one honest line and the door that does work. */
export function PalVoiceOffline() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_UNAVAILABLE_LINE}
      </div>
      <div className="palVoiceActions">
        <Link className="palVoiceWriteLink" href="/pal/chat">
          <Send size={17} aria-hidden="true" /> Ask in writing
        </Link>
      </div>
    </div>
  );
}

function PalVoiceMuted() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_MUTED_LINE}
      </div>
      <div className="palVoiceActions">
        <Link className="palVoiceWriteLink" href="/pal/chat">
          <Send size={17} aria-hidden="true" /> Ask in writing
        </Link>
      </div>
    </div>
  );
}

function useVoiceAvailability(): PalVoiceAvailability {
  const [state, setState] = useState<PalVoiceAvailability>("asking");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/pub-pal/voice-token", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          setState("unavailable");
          return;
        }
        const body: unknown = await response.json().catch(() => ({}));
        setState(palVoiceAvailabilityFrom(true, body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    return () => controller.abort();
  }, []);
  return state;
}

function VoiceAvailabilityGate({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const availability = useVoiceAvailability();

  // Tri-state: while the probe is out the control claims neither, because
  // "voice is off" is a statement we must have checked.
  if (availability === "asking") {
    return (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          Checking whether voice is on
        </div>
      </div>
    );
  }

  if (availability === "unavailable") return <PalVoiceOffline />;

  return <PubPalVoiceSession onStateChange={onStateChange} />;
}

export default function PubPalVoice({
  muted = false,
  onStateChange,
}: {
  muted?: boolean;
  onStateChange?: (state: PalAnimationState) => void;
}) {
  if (muted) return <PalVoiceMuted />;
  return <VoiceAvailabilityGate onStateChange={onStateChange} />;
}
