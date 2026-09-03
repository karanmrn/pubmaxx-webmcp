"use client";

// Screen Wake Lock for Night Mode (U19). While a crew is mid-crawl the phone is
// the shared map, the last-train clock and the "here now" tap; letting it sleep
// every 30s is a small nightly annoyance. This keeps the screen awake ONLY while
// the user opts in — default OFF, because a wake lock costs battery and honesty
// beats a surprise flat phone at 1am.
//
// Feature-detected end to end: where navigator.wakeLock is missing (older iOS,
// non-secure contexts) the hook reports `supported: false` and the toggle is not
// even rendered. iOS Safari 16.4+ ships the Screen Wake Lock API, so most of the
// night-out audience is covered.
//
// The browser silently releases a screen wake lock whenever the tab is hidden
// (backgrounded, screen locked, tab switch). So re-acquisition on
// `visibilitychange` is not a nicety, it is the only way the lock survives the
// user glancing away and coming back. The lock is always released on toggle-off
// and on unmount (card close / plan retire), so it never outlives its purpose.
//
// The acquire/release/re-acquire state machine lives in a plain, framework-free
// manager (createWakeLockManager) so it can be unit-tested against a mocked
// wakeLock without a DOM or React renderer; the hook is a thin wiring layer.

import { useEffect, useRef, useState } from "react";

// Minimal structural types — we do not rely on the DOM lib shipping the Wake
// Lock types (they are absent in some target lib configs), so we model just the
// surface we touch.
export type WakeLockSentinelLike = {
  released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
  removeEventListener?(type: "release", listener: () => void): void;
};

export type WakeLockApiLike = {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
};

export type WakeLockNavigatorLike = {
  wakeLock?: WakeLockApiLike;
};

/** True only when this environment exposes a usable Screen Wake Lock API. */
export function wakeLockSupported(nav: WakeLockNavigatorLike | undefined | null): boolean {
  return !!nav && typeof nav.wakeLock?.request === "function";
}

export type WakeLockManager = {
  /** Whether the underlying API exists at all. */
  readonly supported: boolean;
  /** Arm the lock and acquire it now (idempotent). */
  enable(): Promise<void>;
  /** Disarm and release any held lock (idempotent). */
  disable(): Promise<void>;
  /**
   * Feed a visibility change in. When the page becomes visible again and the
   * lock is armed but the browser dropped the sentinel, re-acquire it. Hiding
   * needs no action: the browser has already released the sentinel for us.
   */
  handleVisibility(visible: boolean): Promise<void>;
  /** True while a live (un-released) sentinel is held. */
  isActive(): boolean;
};

/**
 * Framework-free wake-lock state machine. Owns exactly one sentinel at a time,
 * survives the browser's automatic release-on-hide by re-acquiring when armed
 * and visible again, and reports active-state changes through `onChange`.
 * Every acquire is wrapped: a rejected request (denied, transient failure)
 * simply leaves the lock inactive rather than throwing into the caller.
 */
export function createWakeLockManager(
  nav: WakeLockNavigatorLike | undefined | null,
  onChange?: (active: boolean) => void,
  onError?: () => void,
): WakeLockManager {
  const supported = wakeLockSupported(nav);
  let armed = false;
  let sentinel: WakeLockSentinelLike | null = null;
  // Guards overlapping acquires: two visibility events (or enable + visibility)
  // must not race two `request()` calls into two live sentinels.
  let acquiring: Promise<void> | null = null;

  const setActive = (active: boolean) => {
    onChange?.(active);
  };

  const onSentinelRelease = () => {
    // The browser (or a manual release) let go of THIS sentinel. Drop our
    // reference so a later visibility gain can re-acquire while still armed.
    sentinel = null;
    setActive(false);
  };

  const doAcquire = async (): Promise<void> => {
    if (!supported || !armed || sentinel) return;
    try {
      const next = await nav!.wakeLock!.request("screen");
      if (!armed) {
        // Disabled while the request was in flight — release immediately.
        void next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
      next.addEventListener?.("release", onSentinelRelease);
      setActive(true);
    } catch {
      // Denied or transient: stay inactive, no throw. A later visibility gain
      // may still succeed, but the user must know the toggle did not take.
      setActive(false);
      onError?.();
    }
  };

  const acquire = (): Promise<void> => {
    if (acquiring) return acquiring;
    acquiring = doAcquire().finally(() => {
      acquiring = null;
    });
    return acquiring;
  };

  const releaseHeld = async (): Promise<void> => {
    const held = sentinel;
    sentinel = null;
    if (held) {
      held.removeEventListener?.("release", onSentinelRelease);
      setActive(false);
      await held.release().catch(() => undefined);
    }
  };

  return {
    supported,
    async enable() {
      if (!supported) return;
      armed = true;
      await acquire();
    },
    async disable() {
      armed = false;
      await releaseHeld();
    },
    async handleVisibility(visible: boolean) {
      if (!supported || !armed) return;
      if (visible && !sentinel) await acquire();
    },
    isActive() {
      return sentinel !== null && sentinel.released !== true;
    },
  };
}

export type ScreenWakeLockState = {
  /** The Screen Wake Lock API is available (render the toggle only when true). */
  supported: boolean;
  /** A live screen wake lock is currently held. */
  active: boolean;
  /** User-visible reason when the requested lock could not be acquired. */
  error: string;
};

/**
 * React binding: keep the screen awake while `enabled` is true. Re-acquires on
 * tab-visibility gain, releases on `enabled` going false and on unmount. Safe on
 * SSR / unsupported browsers (returns supported:false and never touches the API).
 */
export function useScreenWakeLock(enabled: boolean): ScreenWakeLockState {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const managerRef = useRef<WakeLockManager | null>(null);
  const [supported] = useState(() =>
    typeof navigator !== "undefined" && wakeLockSupported(navigator as WakeLockNavigatorLike),
  );

  // One manager per mount; wired to visibility and torn down (lock released) on
  // unmount so a closed card never keeps the screen awake.
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    const manager = createWakeLockManager(
      navigator as WakeLockNavigatorLike,
      setActive,
      () => setError("Could not keep screen awake. Try again."),
    );
    managerRef.current = manager;
    const onVisibility = () => {
      void manager.handleVisibility(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void manager.disable();
      managerRef.current = null;
    };
  }, []);

  // Follow the caller's intent. The manager is idempotent, so a re-render with an
  // unchanged value is a no-op.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    setError("");
    if (enabled) void manager.enable();
    else void manager.disable();
  }, [enabled]);

  return { supported, active, error };
}
