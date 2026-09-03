// Single source of truth for the mobile/desktop breakpoint. CSS files can't
// import this, so every `@media (max-width: 640px)` rule (e.g.
// components/nav/mobileNav.css) mirrors the value by hand — change it here and
// grep for 640px to keep the stylesheets in lockstep.

export const MOBILE_MAX_WIDTH = 640;

/** matchMedia query string for "is this a phone-sized viewport?". */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
