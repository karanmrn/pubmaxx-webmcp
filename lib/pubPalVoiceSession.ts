export const PAL_VOICE_START_ERROR = "Voice is unavailable. Use text instead.";
export const PAL_MICROPHONE_PERMISSION_ERROR =
  "Microphone access is off. Use text instead.";

type VoiceProbeStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

type VoiceStartAttempt<TGrant> = {
  requestMicrophone: () => Promise<VoiceProbeStream>;
  issueGrant: () => Promise<TGrant>;
  connect: (grant: TGrant) => void;
  onFailure?: (message: string) => void;
  onCancelled?: () => void;
};

type ActiveVoiceStart = {
  cancelled: boolean;
  grantRequestStarted: boolean;
  grantRequestSettled: boolean;
  cancellationNotified: boolean;
  onCancelled?: () => void;
};

export class PubPalVoiceStartError extends Error {}

function voiceStartErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return PAL_MICROPHONE_PERMISSION_ERROR;
  }
  if (error instanceof PubPalVoiceStartError) return error.message;
  return PAL_VOICE_START_ERROR;
}

function stopProbe(stream: VoiceProbeStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Best effort. Permission is already resolved and the SDK opens its own stream.
    }
  }
}

export function createPubPalVoiceStartController() {
  let locked = false;
  let inFlight: Promise<boolean> | null = null;
  let activeStart: ActiveVoiceStart | null = null;

  const notifyCancellation = (start: ActiveVoiceStart): void => {
    if (start.cancellationNotified) return;
    if (!start.grantRequestStarted || !start.grantRequestSettled) return;
    start.cancellationNotified = true;
    start.onCancelled?.();
  };

  return {
    isStarting: () => locked,
    settle: () => {
      locked = false;
    },
    cancel: () => {
      locked = false;
      if (!activeStart) return;
      activeStart.cancelled = true;
      notifyCancellation(activeStart);
    },
    start<TGrant>(attempt: VoiceStartAttempt<TGrant>): Promise<boolean> {
      if (inFlight) return inFlight;
      if (locked) return Promise.resolve(false);
      locked = true;

      const currentStart: ActiveVoiceStart = {
        cancelled: false,
        grantRequestStarted: false,
        grantRequestSettled: false,
        cancellationNotified: false,
        onCancelled: attempt.onCancelled,
      };
      activeStart = currentStart;

      const current = Promise.resolve()
        .then(async () => {
          try {
            const stream = await attempt.requestMicrophone();
            if (currentStart.cancelled) {
              stopProbe(stream);
              return false;
            }
            stopProbe(stream);
            currentStart.grantRequestStarted = true;
            let grant: TGrant;
            try {
              grant = await attempt.issueGrant();
            } catch (error) {
              currentStart.grantRequestSettled = true;
              if (currentStart.cancelled) {
                notifyCancellation(currentStart);
                return false;
              }
              locked = false;
              attempt.onFailure?.(voiceStartErrorMessage(error));
              return false;
            }
            currentStart.grantRequestSettled = true;
            if (currentStart.cancelled) {
              notifyCancellation(currentStart);
              return false;
            }
            attempt.connect(grant);
            return true;
          } catch (error) {
            if (currentStart.cancelled) return false;
            locked = false;
            attempt.onFailure?.(voiceStartErrorMessage(error));
            return false;
          }
        })
        .finally(() => {
          inFlight = null;
          if (activeStart === currentStart) activeStart = null;
        });
      inFlight = current;
      return current;
    },
  };
}
