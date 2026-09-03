"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  if (typeof localStorage === "undefined") return null;
  const t = localStorage.getItem("pubmax-theme");
  return t === "light" || t === "dark" ? t : null;
}

function domTheme(): Theme {
  if (typeof document === "undefined") return "light";
  // Prefer the attribute the no-flash script set; fall back to the stored
  // choice so the icon stays correct even if hydration dropped the attribute.
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return storedTheme() ?? "light";
}

// useSyncExternalStore reads the theme without a hydration mismatch: the SERVER
// snapshot (and therefore the FIRST client render) is a deterministic "light",
// so server HTML === first client HTML (no #418). After hydration commits, the
// store re-reads the real theme from html[data-theme] and re-renders, and a
// MutationObserver keeps the icon in sync when the theme is toggled or changed
// in another tab. No setState-in-effect (repo enforces that as an error).
function subscribe(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function useTheme(): Theme {
  return useSyncExternalStore(subscribe, domTheme, () => "light");
}

export default function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const theme = useTheme();
  const goingDark = theme === "light";

  // React 19 hydration can strip the attribute the no-flash script set on
  // <html>, so a reload lands with no data-theme even though the choice is
  // still in localStorage. Re-assert it on mount (DOM write only — not
  // setState — so it doesn't trip react-hooks/set-state-in-effect). The
  // MutationObserver above then re-reads it, so the icon resolves too.
  useEffect(() => {
    const t =
      storedTheme() ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = t;
  }, []);

  function toggle() {
    const next: Theme = domTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pubmax-theme", next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={floating ? "themeToggle floating" : "themeToggle"}
      aria-label={goingDark ? "Switch to dark theme" : "Switch to light theme"}
      title={goingDark ? "Switch to dark theme" : "Switch to light theme"}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
