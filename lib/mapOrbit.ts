// Pure idle-orbit state machine for pub map. Canvas owns MapLibre calls. This
// module owns idle timing and hard gates so every transition stays testable.

export type OrbitState = "off" | "waiting" | "orbiting" | "suspended";

type OrbitOptions = {
  firstDelayMs: number;
  interactionDelayMs: number;
  frameIntervalMs: number;
  isReduced: () => boolean;
  startStep: () => void;
  stop: () => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

export type IdleOrbit = {
  /** Enable only after first pin reveal. */
  setEnabled: (enabled: boolean) => void;
  /** Stop for user or programmatic camera input, then use long idle delay. */
  noteInteraction: () => void;
  /** Re-read live gates, such as changed reduced-motion preference. */
  refreshGate: () => void;
  /** Suspend while tab is hidden or canvas is off screen. */
  setSuspended: (suspended: boolean) => void;
  state: () => OrbitState;
  dispose: () => void;
};

export function createIdleOrbit({
  firstDelayMs,
  interactionDelayMs,
  frameIntervalMs,
  isReduced,
  startStep,
  stop,
  setTimer,
  clearTimer,
}: OrbitOptions): IdleOrbit {
  let enabled = false;
  let suspended = false;
  let orbiting = false;
  let timer: number | null = null;
  let disposed = false;
  let hasInteracted = false;

  const clearPendingTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const stopOrbiting = () => {
    if (!orbiting) return;
    orbiting = false;
    stop();
  };

  const gateOpen = () => !disposed && enabled && !suspended && !isReduced();

  const scheduleStep = () => {
    clearPendingTimer();
    if (!gateOpen() || !orbiting) return;
    timer = setTimer(() => {
      timer = null;
      if (!gateOpen()) {
        stopOrbiting();
        return;
      }
      startStep();
      scheduleStep();
    }, frameIntervalMs);
  };

  const armIdleTimer = () => {
    clearPendingTimer();
    if (!gateOpen()) return;
    timer = setTimer(() => {
      timer = null;
      if (!gateOpen()) return;
      orbiting = true;
      startStep();
      scheduleStep();
    }, hasInteracted ? interactionDelayMs : firstDelayMs);
  };

  return {
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) {
        clearPendingTimer();
        stopOrbiting();
        return;
      }
      armIdleTimer();
    },
    noteInteraction() {
      hasInteracted = true;
      clearPendingTimer();
      stopOrbiting();
      armIdleTimer();
    },
    refreshGate() {
      if (!gateOpen()) {
        clearPendingTimer();
        stopOrbiting();
        return;
      }
      if (!orbiting) armIdleTimer();
    },
    setSuspended(next) {
      if (suspended === next) return;
      suspended = next;
      if (suspended) {
        clearPendingTimer();
        stopOrbiting();
        return;
      }
      armIdleTimer();
    },
    state() {
      if (orbiting) return "orbiting";
      if (timer !== null) return "waiting";
      return suspended ? "suspended" : "off";
    },
    dispose() {
      disposed = true;
      clearPendingTimer();
      stopOrbiting();
    },
  };
}

/** Convert speed to one discrete step and enforce caller's maximum. */
export function orbitBearingStep(
  degreesPerSecond: number,
  frameIntervalMs: number,
  maxBearingStepDegrees: number,
): number {
  const requested = Math.abs(degreesPerSecond) * (Math.abs(frameIntervalMs) / 1_000);
  return Math.min(requested, Math.abs(maxBearingStepDegrees));
}

/** Keep explicit camera moves immediate while ambient viewport reads stay calm. */
export function shouldPublishOrbitViewport(
  orbiting: boolean,
  lastPublishedAt: number,
  now: number,
  intervalMs: number,
): boolean {
  return !orbiting || now - lastPublishedAt >= intervalMs;
}

/** Slow drift: one full turn in 10 minutes. */
export const ORBIT_DEG_PER_SEC = 0.6;
/** Four camera updates per second. Continuous MapLibre animation caused churn. */
export const ORBIT_FRAME_INTERVAL_MS = 250;
/** Maximum rotation in one camera update. */
export const ORBIT_MAX_BEARING_STEP_DEG = 0.15;
/** Publish ambient viewport and bounds once per 12-second orbit span. */
export const ORBIT_VIEWPORT_PUBLISH_INTERVAL_MS = 12_000;
/** First idle view starts after pin reveal plus six seconds. */
export const ORBIT_FIRST_DELAY_MS = 6_000;
/** Input gives user 20 seconds before ambient motion can return. */
export const ORBIT_INTERACTION_DELAY_MS = 20_000;
