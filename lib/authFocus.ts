export const AUTH_MENU_FOCUSABLE_SELECTOR =
  "button:not(:disabled), input:not(:disabled), [href]";

/** Return the enabled boundary to focus, or null when native Tab should proceed. */
export function authMenuFocusBoundary<T>(
  enabled: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  if (enabled.length === 0) return null;
  const activeIndex = active === null ? -1 : enabled.indexOf(active);
  if (activeIndex === -1) return backwards ? enabled[enabled.length - 1] : enabled[0];
  if (backwards && activeIndex === 0) return enabled[enabled.length - 1];
  if (!backwards && activeIndex === enabled.length - 1) return enabled[0];
  return null;
}
