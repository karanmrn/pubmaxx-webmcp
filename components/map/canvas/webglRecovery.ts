/**
 * iOS Safari WebGL recovery helpers for PubMapCanvas.
 *
 * Owner report: after app-switch on a real iPhone the basemap canvas goes blank
 * while DOM markers/POIs stay live. Lab cannot reproduce backgrounding, but
 * iOS kills the WebGL context on suspend / restores bfcache pages with a dead
 * canvas, and MapLibre does not auto-rebuild. These pure helpers keep the
 * recovery policy unit-testable inside the canvas code-split boundary (#601).
 */

export type MapCameraSnapshot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

/** Grace window after `webglcontextlost` before we treat the context as dead. */
export const CONTEXT_LOST_RECOVERY_MS = 800;

/**
 * Read loss from a canvas's live WebGL context. Prefer this only when the
 * MapLibre painter gl handle is unavailable — `getContext` after MapLibre
 * constructed the canvas returns the same context object.
 */
export function readWebGlContextLost(canvas: HTMLCanvasElement): boolean {
  try {
    const gl2 = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl2 && typeof gl2.isContextLost === "function") {
      return gl2.isContextLost();
    }
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (gl && typeof gl.isContextLost === "function") {
      return gl.isContextLost();
    }
  } catch {
    // A throw from a half-torn-down GPU process is treated as lost.
    return true;
  }
  // No context at all → treat as lost so we re-init rather than paint grey.
  return true;
}

type PainterGlMap = {
  getCanvas: () => HTMLCanvasElement;
  painter?: { context?: { gl?: { isContextLost?: () => boolean } } };
};

/**
 * Health-check the map's WebGL context. Prefer MapLibre's painter gl (the
 * actual context the renderer uses); fall back to the canvas.
 */
export function isMapWebGlContextLost(map: PainterGlMap): boolean {
  const painterGl = map.painter?.context?.gl;
  if (painterGl && typeof painterGl.isContextLost === "function") {
    try {
      return painterGl.isContextLost();
    } catch {
      return true;
    }
  }
  try {
    return readWebGlContextLost(map.getCanvas());
  } catch {
    return true;
  }
}

type CameraMap = {
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getPitch: () => number;
  getBearing: () => number;
};

/** Snapshot camera so a tear-down + re-init can restore the user's view. */
export function snapshotMapCamera(map: CameraMap): MapCameraSnapshot {
  const c = map.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  };
}

/**
 * Decide what a visibility/pageshow health check should do.
 * Pure so unit tests cover the policy without a real WebGL stack.
 */
export function contextHealthAction(input: {
  contextLost: boolean;
  reinitAlreadySpent: boolean;
}): "repaint" | "reinit" | "soft-retry" {
  if (!input.contextLost) return "repaint";
  if (!input.reinitAlreadySpent) return "reinit";
  return "soft-retry";
}
