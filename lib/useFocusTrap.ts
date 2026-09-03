"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A trap may only stand the rest of the page down when its own container is
 * on screen. The phone sheet portal stays MOUNTED at desktop widths and CSS
 * hides it (`display: none`, mobileMapShell.css). Its React state still runs,
 * so a sheet opened at the `full` detent used to inert the whole desktop app
 * behind a surface nobody could see: every pin, the toolbar search, and the
 * desktop Pint Drop picker's own rows went unclickable and unfocusable.
 * `displayChain` is the computed `display` of the container and each ancestor.
 */
export function shouldEngageFocusTrap(input: {
  active: boolean;
  displayChain: string[];
}): boolean {
  if (!input.active) return false;
  return !input.displayChain.includes("none");
}

export type FocusTrapOutsidePolicy = "strict-modal" | "map-surface";

const strictModalListeners = new Set<() => void>();
let strictModalTrapCount = 0;

export function subscribeStrictModalFocusTrap(listener: () => void): () => void {
  strictModalListeners.add(listener);
  return () => strictModalListeners.delete(listener);
}

export function readStrictModalFocusTrap(): boolean {
  return strictModalTrapCount > 0;
}

export function serverStrictModalFocusTrap(): boolean {
  return false;
}

function publishStrictModalFocusTrap(): void {
  for (const listener of strictModalListeners) listener();
}

function claimStrictModalFocusTrap(): () => void {
  strictModalTrapCount += 1;
  publishStrictModalFocusTrap();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    strictModalTrapCount -= 1;
    publishStrictModalFocusTrap();
  };
}

/** Body-level siblings that may stay interactive only beside a map surface. */
export function shouldInertOutsideSibling(
  node: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): boolean {
  if (outsidePolicy === "strict-modal") return true;
  return !(
    node.classList.contains("mobileTabBar") ||
    node.classList.contains("accountOnboardingBackdrop")
  );
}

type InertOwnership = {
  original: boolean;
  owners: Set<symbol>;
};

const inertOwnership = new WeakMap<HTMLElement, InertOwnership>();

type FocusRestoration = {
  origin: HTMLElement | null;
  active: boolean;
};

const focusRestorations: FocusRestoration[] = [];

function claimInert(node: HTMLElement, owner: symbol): void {
  const ownership = inertOwnership.get(node);
  if (ownership) {
    ownership.owners.add(owner);
  } else {
    inertOwnership.set(node, {
      original: node.inert,
      owners: new Set([owner]),
    });
  }
  node.inert = true;
}

function releaseInert(node: HTMLElement, owner: symbol): void {
  const ownership = inertOwnership.get(node);
  if (!ownership || !ownership.owners.delete(owner)) return;
  if (ownership.owners.size > 0) {
    node.inert = true;
    return;
  }
  node.inert = ownership.original;
  inertOwnership.delete(node);
}

function focusOriginAvailable(origin: HTMLElement | null): origin is HTMLElement {
  if (!origin?.isConnected) return false;
  let cursor: HTMLElement | null = origin;
  while (cursor) {
    if (cursor.inert) return false;
    cursor = cursor.parentElement;
  }
  return true;
}

function restoreFocus(origin: HTMLElement | null): boolean {
  if (!focusOriginAvailable(origin)) return false;
  origin.focus({ preventScroll: true });
  return typeof document === "undefined" || document.activeElement === origin;
}

function releaseFocusRestoration(restoration: FocusRestoration): void {
  const index = focusRestorations.indexOf(restoration);
  if (index < 0 || !restoration.active) return;
  restoration.active = false;
  if (focusRestorations.slice(index + 1).some((entry) => entry.active)) return;

  let activeBarrier = -1;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (focusRestorations[candidate]?.active) {
      activeBarrier = candidate;
      break;
    }
  }
  for (let candidate = index; candidate > activeBarrier; candidate -= 1) {
    if (restoreFocus(focusRestorations[candidate]?.origin ?? null)) break;
  }
  focusRestorations.splice(activeBarrier + 1);
}

export class FocusTrapOwner {
  private readonly owner = Symbol("focus-trap-owner");
  private nodes = new Set<HTMLElement>();
  private focusRestoration: FocusRestoration | null = null;

  captureFocus(origin: HTMLElement | null): void {
    if (this.focusRestoration) return;
    this.focusRestoration = { origin, active: true };
    focusRestorations.push(this.focusRestoration);
  }

  reconcile(nextNodes: Iterable<HTMLElement>): void {
    const next = new Set(nextNodes);
    for (const node of this.nodes) {
      if (!next.has(node)) releaseInert(node, this.owner);
    }
    for (const node of next) {
      if (!this.nodes.has(node)) claimInert(node, this.owner);
    }
    this.nodes = next;
  }

  release(): void {
    this.reconcile([]);
    if (!this.focusRestoration) return;
    releaseFocusRestoration(this.focusRestoration);
    this.focusRestoration = null;
  }
}

function outsideSiblings(
  container: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): Set<HTMLElement> {
  const siblings = new Set<HTMLElement>();
  let cursor: HTMLElement | null = container;
  while (cursor && cursor !== document.body) {
    const parent: HTMLElement | null = cursor.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === cursor || !(sibling instanceof HTMLElement)) continue;
      if (shouldInertOutsideSibling(sibling, outsidePolicy)) siblings.add(sibling);
    }
    cursor = parent;
  }
  return siblings;
}

function displayChain(container: HTMLElement): string[] {
  const chain: string[] = [];
  let cursor: HTMLElement | null = container;
  while (cursor) {
    chain.push(window.getComputedStyle(cursor).display);
    cursor = cursor.parentElement;
  }
  return chain;
}

// Shared modal focus trap, extracted from the mobile bottom sheet
// (MobileSharedSheet) so the desktop venue drawer can reuse the SAME behaviour
// for its full open lifetime. While `active`:
//   1. Tab / Shift+Tab cycle within `containerRef`'s visible focusables.
//   2. Everything OUTSIDE the container is marked `inert` — walking the ancestor
//      chain to <body> and inert-ing each level's off-path siblings. This works
//      whether the trapped node is a body-level portal (mobile sheet) or nested
//      inside the app shell (desktop drawer). Prior `inert` values are restored
//      on teardown.
//   3. A container CSS has hidden never traps at all (shouldEngageFocusTrap).
// Focus entry and restoration are coordinated here; Esc stays with each caller.
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  outsidePolicy: FocusTrapOutsidePolicy = "strict-modal",
  focusOriginRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    if (!shouldEngageFocusTrap({ active, displayChain: displayChain(container) })) return;

    const trapOwner = new FocusTrapOwner();
    trapOwner.captureFocus(
      focusOriginRef
        ? focusOriginRef.current
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    );
    // Main's one-time scan does not contain later body siblings such as Command Palette.
    trapOwner.reconcile(outsideSiblings(container, outsidePolicy));
    const releaseStrictModal =
      outsidePolicy === "strict-modal" ? claimStrictModalFocusTrap() : null;

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onTab);
    return () => {
      container.removeEventListener("keydown", onTab);
      trapOwner.release();
      releaseStrictModal?.();
    };
  }, [active, containerRef, focusOriginRef, outsidePolicy]);
}
