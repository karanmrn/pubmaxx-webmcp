export type SpringState = {
  value: number;
  velocity: number;
};

export type SpringConfig = {
  /** Approximate seconds for one natural response cycle. */
  response: number;
  /** 1 is critically damped. Values below 1 retain release momentum. */
  dampingRatio: number;
};

const MAX_CATCH_UP_SECONDS = 1;
const MAX_STEP_SECONDS = 1 / 240;
const MIN_RESPONSE_SECONDS = 0.05;

/**
 * Advance a damped spring with bounded semi-implicit Euler steps.
 *
 * Value units are caller-defined. Velocity uses those units per second.
 * Small integration steps keep long frames stable. Catching up for at most one
 * second prevents a delayed frame from stretching a short transition across
 * many seconds when a busy browser resumes.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  deltaSeconds: number,
  config: SpringConfig,
): SpringState {
  const frameSeconds = Math.min(Math.max(deltaSeconds, 0), MAX_CATCH_UP_SECONDS);
  if (frameSeconds === 0) return state;

  const response = Math.max(config.response, MIN_RESPONSE_SECONDS);
  const dampingRatio = Math.max(config.dampingRatio, 0);
  const angularFrequency = (2 * Math.PI) / response;
  const stiffness = angularFrequency * angularFrequency;
  const damping = 2 * dampingRatio * angularFrequency;
  const steps = Math.max(1, Math.ceil(frameSeconds / MAX_STEP_SECONDS));
  const stepSeconds = frameSeconds / steps;

  let value = state.value;
  let velocity = state.velocity;
  const startingSide = Math.sign(value - target);

  for (let step = 0; step < steps; step += 1) {
    const acceleration = stiffness * (target - value) - damping * velocity;
    velocity += acceleration * stepSeconds;
    value += velocity * stepSeconds;

    if (
      dampingRatio >= 1 &&
      startingSide !== 0 &&
      Math.sign(value - target) !== startingSide
    ) {
      value = target;
      velocity = 0;
      break;
    }
  }

  return { value, velocity };
}

/**
 * Project a gesture's px/ms release velocity using Apple's geometric
 * deceleration model. A deceleration of 0.998 is the native normal rate.
 */
export function projectMomentum(
  value: number,
  velocityPxPerMillisecond: number,
  deceleration = 0.998,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(velocityPxPerMillisecond)) {
    return value;
  }
  const rate = Math.min(Math.max(deceleration, 0), 0.9999);
  if (rate === 0) return value;
  return value + (velocityPxPerMillisecond * rate) / (1 - rate);
}

export function isSpringSettled(
  state: SpringState,
  target: number,
  positionTolerance = 0.1,
  velocityTolerance = 0.1,
): boolean {
  return (
    Math.abs(state.value - target) <= positionTolerance &&
    Math.abs(state.velocity) <= velocityTolerance
  );
}
