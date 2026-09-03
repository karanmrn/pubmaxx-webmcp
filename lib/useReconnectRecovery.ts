"use client";

import { useEffect, useRef } from "react";

const DEFAULT_RECONNECT_RECOVERY_DEBOUNCE_MS = 150;
const DEFAULT_RECOVERY_EVENTS: readonly ReconnectRecoveryEvent[] = [
  "online",
  "visible",
];

export type ReconnectRecoveryEvent = "online" | "visible" | "pageshow";

type RecoveryWindow = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
type RecoveryDocument = Pick<Document, "addEventListener" | "removeEventListener"> & {
  visibilityState: DocumentVisibilityState;
};

export type ReconnectRecoveryOptions = {
  debounceMs?: number;
  events?: readonly ReconnectRecoveryEvent[];
  windowTarget?: RecoveryWindow;
  documentTarget?: RecoveryDocument;
};

function browserWindow(): RecoveryWindow | null {
  return typeof window === "undefined" ? null : window;
}

function browserDocument(): RecoveryDocument | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Watch browser wake events for one failed surface load.
 *
 * A reconnect and a foreground event close together share one debounced retry.
 * The callback runs once before another browser event can schedule a retry, so a
 * reload that causes its own event cannot create a retry loop.
 */
export function subscribeToReconnectRecovery(
  reload: () => void,
  options: ReconnectRecoveryOptions = {},
): () => void {
  const windowTarget = options.windowTarget ?? browserWindow();
  const documentTarget = options.documentTarget ?? browserDocument();
  if (!windowTarget || !documentTarget) return () => {};

  const debounceMs = options.debounceMs ?? DEFAULT_RECONNECT_RECOVERY_DEBOUNCE_MS;
  const events = options.events ?? DEFAULT_RECOVERY_EVENTS;
  let timer: ReturnType<RecoveryWindow["setTimeout"]> | null = null;
  let eventScheduled = false;

  const schedule = () => {
    if (eventScheduled) return;
    eventScheduled = true;
    timer = windowTarget.setTimeout(() => {
      timer = null;
      try {
        reload();
      } finally {
        eventScheduled = false;
      }
    }, debounceMs);
  };
  const onOnline = () => schedule();
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") schedule();
  };
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) schedule();
  };

  if (events.includes("online")) windowTarget.addEventListener("online", onOnline);
  if (events.includes("visible")) {
    documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (events.includes("pageshow")) windowTarget.addEventListener("pageshow", onPageShow);

  return () => {
    if (events.includes("online")) windowTarget.removeEventListener("online", onOnline);
    if (events.includes("visible")) {
      documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (events.includes("pageshow")) windowTarget.removeEventListener("pageshow", onPageShow);
    if (timer !== null) windowTarget.clearTimeout(timer);
    timer = null;
    eventScheduled = false;
  };
}

export function useReconnectRecovery(
  enabled: boolean,
  reload: () => void,
  options: Pick<ReconnectRecoveryOptions, "debounceMs" | "events"> = {},
): void {
  const reloadRef = useRef(reload);
  const debounceMs = options.debounceMs;
  const events = options.events;

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToReconnectRecovery(
      () => reloadRef.current(),
      {
        ...(debounceMs === undefined ? {} : { debounceMs }),
        ...(events === undefined ? {} : { events }),
      },
    );
  }, [enabled, debounceMs, events]);
}
