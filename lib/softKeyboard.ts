// The one answer to "is the on-screen keyboard covering the bottom of the
// screen right now", and the one place that says what counts as evidence.
//
// A fixed bottom bar is positioned against the LAYOUT viewport, which neither
// iOS Safari nor Android Chrome shrink when the keyboard opens. So the tab bar
// keeps its place while the keyboard rises over it, and it lands on top of
// whatever the person is typing into - which is how it came to float over the
// password form in the captain's screenshot.
//
// TWO facts have to agree before we hide it, because either one alone lies.
// A focused field alone is not a keyboard: a physical keyboard, a desktop
// browser and an iPad with a Magic Keyboard all focus fields and raise
// nothing. A shrunken visual viewport alone is not a keyboard either: a
// collapsing URL bar, a find-in-page strip and pinch zoom all move it. The
// pair together is the honest signal, which is why this module reports the
// pair rather than either half.
//
// The bar is hidden by TRANSFORM alone (components/nav/mobileNav.css, the same
// idiom the open-sheet rule already uses). Nothing here touches the body's
// bottom padding: that clearance is reserved for the bar's own height, and
// dropping it while the keyboard is open would reflow the page underneath the
// caret - the layout jump this fix exists to avoid.

/**
 * How much of the layout viewport the visual viewport must lose before we call
 * it a keyboard.
 *
 * A soft keyboard takes roughly a third of a phone screen (about 300px of an
 * 844px iPhone viewport). The browser chrome that also moves the visual
 * viewport - a collapsing URL bar, a find bar - costs about a tenth. 15% sits
 * between the two with room on both sides.
 */
export const SOFT_KEYBOARD_MIN_SHRINK_RATIO = 0.15;

/** Input types that raise a keyboard. Everything else is a control. */
const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/**
 * Whether this element is the kind of thing a keyboard opens for. A bare
 * `<input>` with no type attribute is a text input, which is why the default
 * here is "text" rather than a refusal.
 */
export function isTextEntryElement(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return TEXT_ENTRY_INPUT_TYPES.has(type);
  }
  // A rich-text surface raises the same keyboard as a textarea. `isContentEditable`
  // is inherited, so a caret inside a child of the editable host answers true.
  return (element as HTMLElement).isContentEditable === true;
}

export type SoftKeyboardEvidence = {
  /** A text input, textarea or editable host currently holds focus. */
  textEntryFocused: boolean;
  /** visualViewport.height, in CSS pixels. */
  visualViewportHeight: number;
  /** window.innerHeight - the layout viewport the fixed bar is pinned to. */
  layoutViewportHeight: number;
};

/**
 * The rule. Both halves must hold, and an unmeasurable viewport answers false:
 * a browser that cannot tell us has not told us there is a keyboard, and
 * hiding the navigation on a guess costs more than leaving it up.
 */
export function softKeyboardOpen(evidence: SoftKeyboardEvidence): boolean {
  if (!evidence.textEntryFocused) return false;
  const { visualViewportHeight: visual, layoutViewportHeight: layout } = evidence;
  if (!Number.isFinite(visual) || !Number.isFinite(layout) || layout <= 0) return false;
  return layout - visual >= layout * SOFT_KEYBOARD_MIN_SHRINK_RATIO;
}

/** Read the live evidence out of the document. Browser only. */
function readEvidence(): SoftKeyboardEvidence {
  const visual = window.visualViewport;
  return {
    textEntryFocused: isTextEntryElement(document.activeElement),
    visualViewportHeight: visual ? visual.height : Number.NaN,
    layoutViewportHeight: window.innerHeight,
  };
}

// useSyncExternalStore requires a cached snapshot: recomputing from the DOM on
// every render would hand React a fresh answer mid-commit. The listeners below
// are the only writers.
let open = false;
const listeners = new Set<() => void>();

function refresh(): void {
  const next = softKeyboardOpen(readEvidence());
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

// `focusout` fires BEFORE the next field takes focus, and during it
// document.activeElement is the body. Recomputing there would answer "no text
// field" for one task every time somebody moves from one field to the next,
// flashing the bar back over the keyboard between them. Deferring by a task
// lets the incoming focus land first; opening is deferred by the same task,
// which is nothing against the keyboard's own animation.
let pendingFocusCheck: ReturnType<typeof setTimeout> | null = null;

function refreshAfterFocusSettles(): void {
  if (pendingFocusCheck !== null) return;
  pendingFocusCheck = setTimeout(() => {
    pendingFocusCheck = null;
    refresh();
  }, 0);
}

/** Current answer. Always false on the server and before the first subscriber. */
export function readSoftKeyboardOpen(): boolean {
  return open;
}

/** SSR/hydration snapshot: the server has no viewport and no caret. */
export function serverSoftKeyboardOpen(): boolean {
  return false;
}

/**
 * Subscribe to keyboard open/close. DOM listeners attach for the first
 * subscriber and detach with the last, so a page with no tab bar pays nothing.
 *
 * `focusin`/`focusout` bubble (unlike focus/blur), so one document listener
 * covers every field on the page. visualViewport `resize` is the keyboard
 * itself; `scroll` is how iOS reports the viewport being pushed up.
 */
export function subscribeSoftKeyboard(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    document.addEventListener("focusin", refreshAfterFocusSettles, true);
    document.addEventListener("focusout", refreshAfterFocusSettles, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    refresh();
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size > 0) return;
    document.removeEventListener("focusin", refreshAfterFocusSettles, true);
    document.removeEventListener("focusout", refreshAfterFocusSettles, true);
    window.visualViewport?.removeEventListener("resize", refresh);
    window.visualViewport?.removeEventListener("scroll", refresh);
    if (pendingFocusCheck !== null) {
      clearTimeout(pendingFocusCheck);
      pendingFocusCheck = null;
    }
    // The bar comes back with the last subscriber gone; leaving `open` true
    // would hide it for the next mount with no keyboard on screen.
    open = false;
  };
}
