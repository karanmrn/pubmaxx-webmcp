"use client";

import { useEffect, useRef } from "react";

/**
 * Escape leaves the panel that is open.
 *
 * A panel anchored to a visible trigger does not join the surface trail
 * (lib/surfaceStack.ts): the way back IS the trigger, still on screen beside it.
 * What such a panel still owes the reader is a keyboard way out, because
 * without one the only exit is a close glyph the reader has to find with a
 * pointer.
 *
 * The handler claims the key, so a panel over the map does not also close the
 * drawer beneath it. One Escape, one level.
 */
export function useDismissOnEscape(open: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}
