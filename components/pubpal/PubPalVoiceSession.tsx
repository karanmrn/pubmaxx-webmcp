"use client";

// The live voice session, and the ONLY module that imports the ElevenLabs SDK.
//
// Split out because of what the gate beside it already knows: voice is
// env-gated per deployment, so `VoiceAvailabilityGate` (PubPalVoice.tsx) asks
// /api/pub-pal/voice-token before anything voice-shaped may render, and on a
// deployment with voice off nothing here ever mounts. The SDK was a static
// import all the same, so every cold /pal parsed a whole conversation runtime
// before first paint, for a control the reader may never reach and the
// deployment may not even offer.
//
// The tri-state is unchanged and stays in PubPalVoice.tsx. This module is only
// ever reached through the `available` branch.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Mic, MicOff, Send } from "lucide-react";

import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { PalAnimationState } from "@/lib/pubPal";
import type { PalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import {
  createPubPalVoiceStartController,
  PAL_VOICE_START_ERROR,
  PubPalVoiceStartError,
} from "@/lib/pubPalVoiceSession";

type VoiceTokenResponse = {
  signedUrl?: string;
  overrides?: PalVoiceOverrides;
  maxSessionSeconds?: number;
  error?: string;
};

type VoiceGrant = Omit<VoiceTokenResponse, "signedUrl"> & { signedUrl: string };

type VoiceSessionAttempt = {
  cancelled: boolean;
  releaseRequired: boolean;
  released: boolean;
  sdkSessionStarted: boolean;
  connectedAt: number | null;
  capTimer: number | null;
};

async function releaseVoiceSession(durationSeconds: number): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", durationSeconds }),
    });
    discardBody(response);
  } catch {
    // Best effort: a failed release must not block ending the local session.
  }
}

function VoiceControls({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [text, setText] = useState("");
  const disposedRef = useRef(false);
  const activeAttemptRef = useRef<VoiceSessionAttempt | null>(null);
  const [startController] = useState(createPubPalVoiceStartController);

  const ownsAttempt = useCallback((attempt: VoiceSessionAttempt): boolean => (
    activeAttemptRef.current === attempt &&
    !attempt.cancelled &&
    !disposedRef.current
  ), []);

  const clearCapTimer = useCallback((attempt: VoiceSessionAttempt): void => {
    if (attempt.capTimer !== null) {
      window.clearTimeout(attempt.capTimer);
      attempt.capTimer = null;
    }
  }, []);

  const finalizeSession = useCallback(async (attempt: VoiceSessionAttempt) => {
    if (attempt.released) return;
    clearCapTimer(attempt);
    const durationSeconds = attempt.connectedAt === null
      ? 0
      : Math.max(0, Math.round((Date.now() - attempt.connectedAt) / 1000));
    attempt.connectedAt = null;
    if (!attempt.releaseRequired) return;
    attempt.released = true;
    await releaseVoiceSession(durationSeconds);
  }, [clearCapTimer]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const attempt = activeAttemptRef.current;
      if (!attempt) {
        startController.cancel();
        return;
      }
      attempt.cancelled = true;
      if (attempt.sdkSessionStarted) {
        attempt.sdkSessionStarted = false;
        endSession();
      }
      startController.cancel();
      void finalizeSession(attempt);
    };
  }, [endSession, finalizeSession, startController]);

  useEffect(() => {
    if (status !== "connected") onStateChange?.("idle");
    else if (isSpeaking) onStateChange?.("speaking");
    else if (isListening) onStateChange?.("listening");
  }, [isListening, isSpeaking, onStateChange, status]);

  const stop = useCallback(async (attempt: VoiceSessionAttempt) => {
    if (!ownsAttempt(attempt)) return;
    const wasCurrent = activeAttemptRef.current === attempt;
    attempt.cancelled = true;
    startController.settle();
    setIsStarting(false);
    if (attempt.sdkSessionStarted) {
      attempt.sdkSessionStarted = false;
      endSession();
    }
    await finalizeSession(attempt);
    if (wasCurrent && activeAttemptRef.current === attempt && !disposedRef.current) {
      onStateChange?.("idle");
    }
  }, [endSession, finalizeSession, onStateChange, ownsAttempt, startController]);

  const stopCurrentAttempt = useCallback((): void => {
    const attempt = activeAttemptRef.current;
    if (attempt) void stop(attempt);
  }, [stop]);

  const start = async () => {
    if (disposedRef.current) return;
    if (startController.isStarting()) return;
    const attempt: VoiceSessionAttempt = {
      cancelled: false,
      releaseRequired: false,
      released: false,
      sdkSessionStarted: false,
      connectedAt: null,
      capTimer: null,
    };
    activeAttemptRef.current = attempt;
    setError(null);
    setIsStarting(true);
    onStateChange?.("noticing");
    const started = await startController.start<VoiceGrant>({
      requestMicrophone: async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new PubPalVoiceStartError("Microphone is unavailable. Use text instead.");
        }
        return navigator.mediaDevices.getUserMedia({ audio: true });
      },
      issueGrant: async () => {
        const response = await authedActionFetch("/api/pub-pal/voice-token", { method: "POST" });
        if (response.ok) attempt.releaseRequired = true;
        const body = await response.json() as VoiceTokenResponse;
        if (!response.ok || !body.signedUrl) {
          throw new PubPalVoiceStartError(
            errorMessageFrom(body, "Voice is unavailable. Use text instead."),
          );
        }
        return { ...body, signedUrl: body.signedUrl };
      },
      connect: (grant) => {
        if (!ownsAttempt(attempt)) {
          void finalizeSession(attempt);
          return;
        }
        const maxSessionSeconds = grant.maxSessionSeconds ?? PAL_VOICE_MAX_SESSION_SECONDS;
        const overrides = grant.overrides;
        attempt.sdkSessionStarted = true;
        startSession({
          signedUrl: grant.signedUrl,
          connectionType: "websocket",
          overrides: overrides
            ? {
                agent: {
                  prompt: { prompt: overrides.systemPrompt },
                  firstMessage: overrides.firstMessage,
                },
                ...(overrides.voiceId
                  ? { tts: { voiceId: overrides.voiceId } }
                  : {}),
              }
            : undefined,
          onConnect: () => {
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            attempt.connectedAt = Date.now();
            clearCapTimer(attempt);
            attempt.capTimer = window.setTimeout(() => {
              void stop(attempt);
            }, maxSessionSeconds * 1000);
          },
          onDisconnect: () => {
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            attempt.cancelled = true;
            attempt.sdkSessionStarted = false;
            void finalizeSession(attempt);
          },
          onError: () => {
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            attempt.cancelled = true;
            if (attempt.sdkSessionStarted) {
              attempt.sdkSessionStarted = false;
              endSession();
            }
            setError(PAL_VOICE_START_ERROR);
            onStateChange?.("error");
            void finalizeSession(attempt);
          },
        });
      },
      onFailure: (message) => {
        void finalizeSession(attempt);
        if (!ownsAttempt(attempt)) return;
        attempt.cancelled = true;
        setIsStarting(false);
        setError(message);
        onStateChange?.("error");
      },
      onCancelled: () => {
        void finalizeSession(attempt);
      },
    });
    if (!started && !startController.isStarting() && !disposedRef.current) {
      setIsStarting(false);
    }
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onStateChange?.("thinking");
    sendUserMessage(value);
    setText("");
  };

  return (
    <div className="palVoice">
      <div className="palVoiceStatus" role="status">
        <i className={status === "connected" ? "isLive" : ""} />
        {isStarting
          ? "Starting voice"
          : status === "connected"
            ? "Pal is listening"
            : "Voice ready when you are"}
      </div>
      <div className="palVoiceActions">
        {status === "connected" ? (
          <button type="button" onClick={stopCurrentAttempt}>
            <MicOff size={18} /> End
          </button>
        ) : (
          <button
            type="button"
            disabled={isStarting}
            aria-busy={isStarting}
            onClick={() => { void start(); }}
          >
            <Mic size={18} /> {isStarting ? "Starting" : "Start voice chat"}
          </button>
        )}
        <label>
          <span className="srOnly">Message your Pub Pal</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") send(); }}
            placeholder="Or type the night you want…"
          />
          <button type="button" onClick={send} aria-label="Send message">
            <Send size={17} />
          </button>
        </label>
      </div>
      {error && <p className="palVoiceError" role="alert">{error}</p>}
      <p className="palVoicePrivacy">
        No audio or transcript becomes memory. The Pal proposes facts for you to approve separately.
      </p>
    </div>
  );
}

/** The provider plus its controls. Mounted only once the probe says yes. */
export default function PubPalVoiceSession({
  onStateChange,
}: {
  onStateChange?: (state: PalAnimationState) => void;
}) {
  return (
    <ConversationProvider>
      <VoiceControls onStateChange={onStateChange} />
    </ConversationProvider>
  );
}
