// Aperture splash pre-paint eligibility (PIECE 3 of feat(landing): hero
// scroll cinema with aperture splash). Runs before paint, same reason and
// same pattern as theme-init.js: served as a static file (CSP script-src
// 'self', no per-build hash) and loaded as a render-blocking classic script
// in <head>, so the decision lands before the browser paints the overlay
// markup in components/splash/SplashAperture.tsx.
//
// Eligible only when ALL of:
//   - landing route ("/") - the splash is one continuous shot into the hero
//     cinema's dark-start frame, which only exists there.
//   - not seen yet this session (sessionStorage, once per tab session).
//   - prefers-reduced-motion is not set - the splash is pure motion, no
//     content, so reduced motion means skip entirely rather than a static
//     fallback.
//   - navigator.webdriver is not set - automated browsers (Playwright,
//     Puppeteer, most bots) skip by default; the dedicated e2e spec opts
//     back in via page.addInitScript overriding navigator.webdriver.
// Any eligible session sets html[data-splash="on"], which is the only thing
// components/splash/splashAperture.css keys off. Ineligible loads never
// touch the DOM here - the overlay's CSS default (no attribute) is already
// the zero-cost, zero-CLS fallback.
(function () {
  try {
    if (window.location.pathname !== "/") return;
    if (window.navigator.webdriver) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.sessionStorage.getItem("pubmax-splash-seen")) return;
    window.sessionStorage.setItem("pubmax-splash-seen", "1");
    document.documentElement.dataset.splash = "on";
  } catch {}
})();
