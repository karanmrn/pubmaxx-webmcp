"use client";

// Global owner of the ⌘K command palette (feature N1). Mounts once at the root
// (app/layout.tsx), owns open/close state, binds the global ⌘K / Ctrl+K
// shortcut (and Esc while open), and exposes an imperative open/close/toggle
// API via context so any client component (e.g. SiteNav's ⌘K affordance) can
// pop the palette. The dialog itself is only rendered while open, so "open"
// state and "mounted" stay identical — see CommandPalette.tsx.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// The dialog is fetched when it first opens, not when the app boots. This
// provider is mounted at the root on EVERY route, so a static import put the
// palette, its command table, its filter and its stylesheet into the shared
// shell that a phone downloads to read the landing - for an affordance a phone
// has no key to reach. Open state and mounted stay identical, which is what
// makes the split invisible: the chunk is requested by the same state change
// that used to render it.
const CommandPalette = dynamic(() => import("./CommandPalette"), {
  ssr: false,
  loading: () => null,
});

type CommandPaletteApi = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

// Inert fallback so a component that reads the hook while rendered outside the
// provider (isolated tests, storybook, etc.) never crashes — the palette simply
// can't be opened there.
const NOOP_API: CommandPaletteApi = {
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
};

const CommandPaletteContext = createContext<CommandPaletteApi | null>(null);

/** Imperative handle onto the global palette (open/close/toggle + isOpen). */
export function useCommandPalette(): CommandPaletteApi {
  return useContext(CommandPaletteContext) ?? NOOP_API;
}

export default function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K (mac) / Ctrl+K (win/linux) always toggles — even from inside an
      // input — and we preventDefault so the browser's own ⌘K doesn't fire.
      const isPaletteKey =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "k" || event.key === "K");
      if (isPaletteKey) {
        event.preventDefault();
        setIsOpen((v) => !v);
        return;
      }
      // Esc closes when open (the dialog also handles this locally; both are
      // idempotent). Left as a global safety net.
      if (event.key === "Escape") {
        setIsOpen((wasOpen) => (wasOpen ? false : wasOpen));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const api = useMemo<CommandPaletteApi>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      {isOpen ? <CommandPalette onClose={close} /> : null}
    </CommandPaletteContext.Provider>
  );
}
