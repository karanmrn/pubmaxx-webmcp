"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import {
  CREATE_FAB_ACTIONS,
  createFabMenuVisible,
  createFabVisible,
  returnToFromLocation,
} from "@/components/nav/createFabActions";
import { trackEvent } from "@/lib/analytics";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import {
  readStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
} from "@/lib/useFocusTrap";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./createFab.css";

// The compose affordance. A Moment carries the route it was composed from,
// including its query, and the router's own reading is the SSR-safe fallback
// behind the live address bar (see returnToFromLocation). Reading useSearchParams
// at all puts this behind a Suspense boundary of its own: it is mounted in the
// root layout, and `/` and `/map` are prerendered documents that an unwrapped
// read would pull back to per-request.
export default function CreateFab() {
  return (
    <Suspense fallback={null}>
      <CreateFabGate />
    </Suspense>
  );
}

function CreateFabGate() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  if (!shouldShowMobileTabBar(pathname)) return null;
  // The tab bar rides every route; compose is the narrower question.
  if (!createFabVisible(pathname)) return null;
  return <CreateFabContent routerReturnTo={`${pathname}${query ? `?${query}` : ""}`} />;
}

function CreateFabContent({ routerReturnTo }: { routerReturnTo: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  // Read when the sheet opens, not on every render: opening is the gesture that
  // fixes which route the composer is leaving, and the address cannot move again
  // while the sheet covers it.
  const [returnTo, setReturnTo] = useState(routerReturnTo);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );
  const strictModalOpen = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    readStrictModalFocusTrap,
    serverStrictModalFocusTrap,
  );
  const chromeWithdrawn = keyboardOpen || strictModalOpen;

  const close = useCallback(() => setOpen(false), []);
  useDismissOnEscape(open, close);

  // The sheet leaves with the control, and it does NOT come back when the
  // keyboard goes down. Adjusted during render rather than in an effect: an
  // effect would paint one frame of a menu over the caret first.
  const [keyboardWas, setKeyboardWas] = useState(keyboardOpen);
  if (keyboardOpen !== keyboardWas) {
    setKeyboardWas(keyboardOpen);
    if (keyboardOpen && open) setOpen(false);
  }

  // A panel anchored to a visible trigger owes Escape AND an outside tap
  // (lib/surfaceStack.ts): it is not in the surface trail, so the way out has to
  // be the two ordinary ones.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const menuOpen = createFabMenuVisible(open, keyboardOpen);

  return (
    <div
      ref={rootRef}
      className={"createFabRoot" + (keyboardOpen ? " isKeyboardHidden" : "")}
      // Hidden from the reader means hidden from a screen reader and from the
      // keyboard's own next-field key too. The tab bar beside it takes the same
      // pair for the same reason: a control that has slid off the bottom of the
      // screen must not still be a tab stop above the keyboard.
      aria-hidden={keyboardOpen || undefined}
      inert={chromeWithdrawn || undefined}
    >
      {menuOpen ? (
        // Three ordinary links behind a disclosure, NOT an ARIA menu: role="menu"
        // promises arrow-key roving and a focus move on open, and a promise the
        // keyboard does not keep is worse than the plain shape.
        <div className="createFabMenu" id={menuId} aria-label="Create">
          {CREATE_FAB_ACTIONS.map((item) => (
            <Link
              key={item.action}
              className="createFabRow"
              href={item.hrefFor(returnTo)}
              onClick={() => {
                trackEvent("create_fab_action", { action: item.action });
                // A client-side navigation leaves this component mounted, so a
                // sheet nobody closed stays painted over the destination.
                close();
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="createFab"
        data-testid="create-fab"
        aria-label="Create"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        tabIndex={chromeWithdrawn ? -1 : undefined}
        onClick={() => {
          const next = !open;
          if (next) {
            setReturnTo(
              returnToFromLocation(
                typeof window === "undefined" ? null : window.location,
                routerReturnTo,
              ),
            );
          }
          setOpen(next);
        }}
      >
        <Plus size={24} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
