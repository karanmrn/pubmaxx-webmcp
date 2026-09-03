export type CameraIntentKind = "city" | "cluster" | "nearby" | "query" | "route" | "venue" | "landmark" | "area";

type CameraIntentCoordinatorOptions = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now?: () => number;
  dedupeMs?: number;
  onRun?: (kind: CameraIntentKind, sequence: number) => void;
};

/**
 * Serialises every camera request into one latest-wins lane. Intent identity is
 * deliberately separate from the callback so React effect churn cannot restart
 * an equivalent MapLibre animation and produce a visible zoom flash.
 */
export function createCameraIntentCoordinator({
  requestFrame,
  cancelFrame,
  now = () => performance.now(),
  dedupeMs = 800,
  onRun,
}: CameraIntentCoordinatorOptions) {
  let pendingFrame: number | null = null;
  let pendingKey = "";
  let lastKey = "";
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let sequence = 0;
  let callbackGeneration = 0;

  function schedule(kind: CameraIntentKind, key: string, run: () => void): boolean {
    const timestamp = now();
    if (pendingFrame !== null && key === pendingKey) return false;
    if (key === lastKey && timestamp - lastRunAt < dedupeMs) return false;
    if (pendingFrame !== null) {
      callbackGeneration += 1;
      cancelFrame(pendingFrame);
    }
    pendingKey = key;
    const scheduledGeneration = ++callbackGeneration;
    pendingFrame = requestFrame(() => {
      if (scheduledGeneration !== callbackGeneration) return;
      pendingFrame = null;
      const settledKey = pendingKey;
      pendingKey = "";
      sequence += 1;
      onRun?.(kind, sequence);
      run();
      lastKey = settledKey;
      lastRunAt = now();
    });
    return true;
  }

  function dispose(): void {
    callbackGeneration += 1;
    if (pendingFrame !== null) cancelFrame(pendingFrame);
    pendingFrame = null;
    pendingKey = "";
  }

  return { schedule, dispose };
}
