/**
 * Where a reader is, and how they get out.
 *
 * Every panel, sheet, dialog and overlay in this product opens OVER something.
 * Before this module each one carried its own close button and nothing else, so
 * a reader three surfaces deep could shut the top one and land somewhere they
 * never chose. There was no way to step back, and no way to leave.
 *
 * The model is a stack of what the reader opened, newest last. It answers two
 * questions and no others:
 *
 *   BACK - which surface opened this one, and what state did it hold?
 *   HOME - what is the top level, reachable in one action from any depth?
 *
 * The stack carries a `state` snapshot per entry, because Back must give the
 * reader what they had. A Back that reopens a parent at its defaults loses the
 * filter they set or the tab they picked, which reads as a second dead end.
 *
 * Two rules keep the stack finite and truthful:
 *
 *   - Re-opening the surface a reader is already on REPLACES it. Tapping the
 *     same chip twice is not a level.
 *   - Opening a surface already lower in the stack TRUNCATES back to it. A loop
 *     (area, near me, area) is a return, not a third level, so Back from there
 *     must reach the map rather than walk the reader round the loop again.
 *
 * The stack is presentation-free: it holds ids, titles and opaque state. What a
 * surface looks like belongs to the surface.
 */

/** A surface's stable id. One id per openable surface, product-wide. */
export type SurfaceId = string;

export type SurfaceEntry<S = unknown> = {
  id: SurfaceId;
  /**
   * What the reader calls this surface. It names the Back action that returns
   * to it, so it has to be the same words the surface prints as its heading.
   */
  title: string;
  /**
   * What this surface held when the reader left it. Restored on Back. Opaque
   * to this module; the host decides its shape.
   */
  state?: S;
};

export type SurfaceStack<S = unknown> = readonly SurfaceEntry<S>[];

export const ROOT_SURFACE_STACK: SurfaceStack = [];

/**
 * The deepest a reader may go. A stack is a trail, not a log: beyond this many
 * levels the oldest entry is dropped, because a Back chain nobody can hold in
 * their head is not an escape route.
 */
export const MAX_SURFACE_DEPTH = 8;

export function surfaceDepth(stack: SurfaceStack): number {
  return stack.length;
}

/** The surface the reader is looking at, or null at the top level. */
export function currentSurface<S>(stack: SurfaceStack<S>): SurfaceEntry<S> | null {
  return stack.length ? stack[stack.length - 1]! : null;
}

/** The surface that opened the current one, or null when the parent is home. */
export function parentSurface<S>(stack: SurfaceStack<S>): SurfaceEntry<S> | null {
  return stack.length > 1 ? stack[stack.length - 2]! : null;
}

/** True when Back has somewhere to go that is not home. */
export function canGoBack(stack: SurfaceStack): boolean {
  return stack.length > 1;
}

/**
 * Open `entry` over the current stack.
 *
 * Same id as the current surface: replace it (with the newer state, so a
 * re-open never restores a stale snapshot). Id already lower down: truncate
 * back to it. Otherwise: push, dropping the oldest entry past MAX_SURFACE_DEPTH.
 */
export function openSurface<S>(
  stack: SurfaceStack<S>,
  entry: SurfaceEntry<S>,
): SurfaceStack<S> {
  const existing = stack.findIndex((held) => held.id === entry.id);
  if (existing >= 0) return [...stack.slice(0, existing), entry];
  const next = [...stack, entry];
  return next.length > MAX_SURFACE_DEPTH ? next.slice(next.length - MAX_SURFACE_DEPTH) : next;
}

/**
 * Record what the current surface holds, without changing where the reader is.
 *
 * The host calls this as a surface's own state moves (a tab, a filter, a
 * scroll), so the snapshot Back restores is the one the reader actually left.
 */
export function rememberSurfaceState<S>(stack: SurfaceStack<S>, state: S): SurfaceStack<S> {
  if (!stack.length) return stack;
  const top = stack[stack.length - 1]!;
  if (top.state === state) return stack;
  return [...stack.slice(0, -1), { ...top, state }];
}

/** Step back one level. At the top level this is already home. */
export function backSurface<S>(stack: SurfaceStack<S>): SurfaceStack<S> {
  return stack.length ? stack.slice(0, -1) : stack;
}

/** Leave every open surface and reach the top level, from any depth. */
export function homeSurface<S>(): SurfaceStack<S> {
  return ROOT_SURFACE_STACK as SurfaceStack<S>;
}

/**
 * The accessible name of the Back action, or null when there is no parent.
 *
 * It names the destination rather than the direction, because "Back" alone
 * tells a reader who lost their place nothing about where they are going.
 */
export function backActionLabel(stack: SurfaceStack): string | null {
  const parent = parentSurface(stack);
  return parent ? `Back to ${parent.title}` : null;
}

/**
 * The accessible name of the Home action. `homeTitle` is what the host page
 * calls its own top level ("the map", "Today").
 */
export function homeActionLabel(homeTitle: string): string {
  return `Close and return to ${homeTitle}`;
}

/**
 * The trail a reader has walked, oldest first, as plain titles. The nav prints
 * no breadcrumb, but tests and accessible descriptions read it.
 */
export function surfaceTrail(stack: SurfaceStack): readonly string[] {
  return stack.map((entry) => entry.title);
}
