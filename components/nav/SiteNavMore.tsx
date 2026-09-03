"use client";

// Desktop SiteNav "More" overflow (Wave D2.2). Secondary destinations that are
// not in the primary Now/Map/Out/Social/You row. Desktop ≥641 only -
// CSS hides this entire control on phones so the compact bar stays unchanged.
// Link and action items share one implementation. Esc closes; ArrowUp/Down
// move focus.
//
// Menu is portaled to document.body with position:fixed. The siteNavBar uses
// backdrop-filter + pill border-radius, which clips absolutely positioned
// descendants (design-gate: Historic/Pal were cut off). Portaling escapes that.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export const SITE_NAV_MORE_LINKS = [
  { href: "/plan", label: "Plan", description: "Build a three-stop outing" },
  { href: "/near", label: "Near", description: "Find priced pubs close to you" },
  { href: "/historic", label: "Historic", description: "Read the stories behind old pubs" },
  { href: "/pal", label: "Pal", description: "Ask for a pub that fits tonight" },
] as const;

type SiteNavMoreLinkItem = {
  href: string;
  label: string;
  description: string;
  id?: never;
  onSelect?: never;
};

type SiteNavMoreActionItem = {
  id: string;
  label: string;
  description: string;
  onSelect: () => void | Promise<void>;
  href?: never;
};

export type SiteNavMoreItem =
  | SiteNavMoreLinkItem
  | SiteNavMoreActionItem;

type SiteNavMoreProps = {
  items?: readonly SiteNavMoreItem[];
  label?: string;
  ariaLabel?: string;
  className?: string;
};

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type MenuCoords = { top: number; right: number; maxHeight: number };

const MENU_VIEWPORT_GUTTER = 8;

export default function SiteNavMore({
  items = SITE_NAV_MORE_LINKS,
  label = "More",
  ariaLabel = "More pages",
  className,
}: SiteNavMoreProps = {}): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const pendingFocusRef = useRef<"first" | "last" | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const close = useCallback(() => {
    pendingFocusRef.current = null;
    setOpen(false);
  }, []);

  const measure = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const top = rect.bottom + MENU_VIEWPORT_GUTTER;
    setCoords({
      top,
      right: Math.max(MENU_VIEWPORT_GUTTER, window.innerWidth - rect.right),
      maxHeight: Math.max(0, window.innerHeight - top - MENU_VIEWPORT_GUTTER),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useLayoutEffect(() => {
    if (!open || !coords || !pendingFocusRef.current) return;
    const focusableItems = itemRefs.current.filter(Boolean) as HTMLElement[];
    const target =
      pendingFocusRef.current === "last"
        ? focusableItems[focusableItems.length - 1]
        : focusableItems[0];
    pendingFocusRef.current = null;
    target?.focus();
  }, [coords, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onReposition() {
      measure();
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    // Capture scroll from any ancestor so fixed coords stay aligned.
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, measure]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const focusableItems = itemRefs.current.filter(Boolean) as HTMLElement[];
    if (!focusableItems.length) return;
    const current = document.activeElement;
    const index = focusableItems.findIndex((el) => el === current);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = index < 0 ? 0 : (index + 1) % focusableItems.length;
      focusableItems[next]?.focus();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        index < 0
          ? focusableItems.length - 1
          : (index - 1 + focusableItems.length) % focusableItems.length;
      focusableItems[next]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusableItems[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusableItems[focusableItems.length - 1]?.focus();
    }
  }

  function openFromTrigger(target: "first" | "last") {
    pendingFocusRef.current = target;
    if (open && coords) {
      const focusableItems = itemRefs.current.filter(Boolean) as HTMLElement[];
      const item =
        target === "last"
          ? focusableItems[focusableItems.length - 1]
          : focusableItems[0];
      pendingFocusRef.current = null;
      item?.focus();
      return;
    }
    setOpen(true);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openFromTrigger(event.key === "ArrowUp" ? "last" : "first");
  }

  const menuStyle: CSSProperties | undefined = coords
    ? { top: coords.top, right: coords.right, maxHeight: coords.maxHeight }
    : undefined;

  // Portal only in the browser (document exists after hydration). Avoid a
  // mounted-flag effect — house lint forbids setState in effect bodies.
  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="siteNavMoreMenu siteNavMoreMenuPortaled"
            id={menuId}
            role="menu"
            aria-label={ariaLabel}
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item, index) => {
              const contents = (
                <>
                  <span className="siteNavMoreLabel">{item.label}</span>
                  <span className="siteNavMoreDescription">
                    {item.description}
                  </span>
                </>
              );
              if (item.href) {
                const active = pathMatches(pathname, item.href);
                return (
                <Link
                  key={item.href}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  href={item.href}
                  role="menuitem"
                  className={active ? "siteNavMoreItem isActive" : "siteNavMoreItem"}
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                >
                  {contents}
                </Link>
                );
              }
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitem"
                  className="siteNavMoreItem"
                  onClick={() => {
                    close();
                    void item.onSelect?.();
                  }}
                >
                  {contents}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={className ? `siteNavMore ${className}` : "siteNavMore"}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "siteNavMoreBtn isOpen" : "siteNavMoreBtn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          openFromTrigger("first");
        }}
      >
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" className="siteNavMoreChevron" />
      </button>
      {menu}
    </div>
  );
}
