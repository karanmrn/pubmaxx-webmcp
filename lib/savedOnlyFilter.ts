/**
 * "Saved only" map filter — presentation contract shared by the desktop
 * ControlRail and the phone Filters sheet. The filter itself lives in PubMap
 * (savedOnly state + savedIds narrowing); these strings are the one field and
 * empty-state copy both surfaces must speak.
 */

/** Accessible name for the Saved only checkbox. */
export const SAVED_ONLY_ARIA_LABEL = "Show only venues you have saved";

/**
 * Empty-state when Saved only is on and this device has no saved pubs.
 * Points at Save on a pub sheet; never invents a list or a count.
 */
export const SAVED_ONLY_EMPTY_NOTE =
  'No saved pubs yet. Tap a pub and Save it, then flip "Saved only" back on to see just your list.';
