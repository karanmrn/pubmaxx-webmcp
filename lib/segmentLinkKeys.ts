import type { KeyboardEvent } from "react";

/**
 * A segmented control whose options are LINKS.
 *
 * Day | Tonight and the /out day chips look like a radiogroup and are not one:
 * each option is a destination, so the URL is the truth and nothing is
 * remembered. They wore `role="radio"` for the look, which replaced the link
 * role a screen reader announces, promised Space as the activation key, and
 * then did not honour it - an anchor answers Enter alone. They are plain links
 * with `aria-current="page"` now, and this is the one thing they add on top:
 * Space activates the focused option the way it does on a segmented button, so
 * both keys work rather than one being advertised and refused.
 */
export function isSegmentActivationKey(key: string): boolean {
  // "Spacebar" is the legacy name older engines still send.
  return key === " " || key === "Spacebar";
}

export function handleSegmentLinkKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (!isSegmentActivationKey(event.key)) return;
  // Never let Space scroll the page out from under a control it just took.
  event.preventDefault();
  event.currentTarget.click();
}
