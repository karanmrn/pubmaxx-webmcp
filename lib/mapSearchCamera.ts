// What a TYPED map search is allowed to do to the camera, and when.
//
// The map used to answer every keystroke 320ms later: one match flew to that
// pub and opened its sheet, several matches refitted the camera around them
// all. Both ran while the reader still had the caret in the search field, and
// the single-match path closes the search overlay on its way (selectVenue
// drops the map overlay). So a reader typing a pub name lost the field after
// about two characters, watched the rest of the word go nowhere, and was left
// looking at a camera that had flown out past the M25.
//
// A search field under a reader's finger owns the screen. Nothing may move the
// camera until the caret leaves it. The move is deferred, never dropped: the
// same decision runs again the moment focus goes, so a reader who types and
// then taps the map still gets their matches framed.

/** What the typed-search debounce should do when it fires. */
export type TypedSearchCameraMove =
  /** Leave the camera exactly where it is. */
  | "none"
  /** Exactly one match: fly to it and open its sheet. */
  | "select-one"
  /** Several matches: frame them all so none stay hidden off-screen. */
  | "fit-many";

/** Below this, a query is a stray key rather than a deliberate lookup. */
export const TYPED_SEARCH_MIN_QUERY = 2;

export function typedSearchCameraMove(input: {
  /** The trimmed query. */
  query: string;
  /** How many venues currently match it. */
  matchCount: number;
  /**
   * True while the caret sits in a map search field. The one rule this module
   * exists for: a focused field freezes the camera.
   */
  searchFieldFocused: boolean;
  /**
   * True once an explicit pick (an area, a pub) has already pointed the camera
   * at an answer for THIS query. The reader chose; the debounce stands down.
   */
  cameraOwnedByPick: boolean;
}): TypedSearchCameraMove {
  if (input.query.length < TYPED_SEARCH_MIN_QUERY) return "none";
  if (input.searchFieldFocused) return "none";
  if (input.cameraOwnedByPick) return "none";
  if (input.matchCount === 1) return "select-one";
  if (input.matchCount > 1) return "fit-many";
  return "none";
}

/** The map search fields, both the phone overlay and the desktop toolbar. */
export const MAP_SEARCH_FIELD_SELECTOR = ".mapSearchSuggest input";

/** True when the given element is one of those fields. */
export function isMapSearchField(element: Element | null): boolean {
  if (!element) return false;
  return typeof element.matches === "function" && element.matches(MAP_SEARCH_FIELD_SELECTOR);
}
