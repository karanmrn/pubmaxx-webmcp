/** Shared id for the page's primary `<main>` landmark — skip links target this. */
export const MAIN_LANDMARK_ID = "main";

type FocusableLandmark = {
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

type LandmarkDocument = {
  getElementById: (id: string) => FocusableLandmark | null;
};

/**
 * Move keyboard focus onto `#main`, making the landmark focusable when needed.
 * Returns false when the page has no matching landmark.
 */
export function focusMainLandmark(
  doc: LandmarkDocument = typeof document !== "undefined"
    ? document
    : { getElementById: () => null },
): boolean {
  const main = doc.getElementById(MAIN_LANDMARK_ID);
  if (!main) return false;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
  }
  main.focus();
  main.scrollIntoView({ block: "start" });
  if (typeof window !== "undefined" && window.location.hash !== `#${MAIN_LANDMARK_ID}`) {
    window.history.replaceState(null, "", `#${MAIN_LANDMARK_ID}`);
  }
  return true;
}
