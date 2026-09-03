import "./splashAperture.css";

/**
 * Aperture splash (PIECE 3 of feat(landing): hero scroll cinema with
 * aperture splash). Always renders, first child of <body> (app/layout.tsx),
 * so there is zero layout shift either way. Whether it ANIMATES is gated
 * entirely by html[data-splash="on"], set pre-paint by public/splash-init.js
 * - this component carries no logic of its own and reads no eligibility
 * signal itself. Ineligible loads keep #pubmax-splash's CSS default
 * (display: none), so the whole thing costs nothing there.
 *
 * The mark is the same three coral polygons as public/favicon-x.svg, minus
 * its white rounded-square background - the splash supplies its own
 * near-black backdrop instead, so it never renders as a bare pale X on flat
 * dark.
 */
export default function SplashAperture() {
  return (
    <div id="pubmax-splash" aria-hidden="true">
      <svg
        className="pubmaxSplashMark"
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <g transform="translate(32 32) scale(0.9) translate(-32 -32)">
          <polygon points="42,10 47,10 13,54 8,54" fill="var(--brass)" />
          <polygon points="51,10 56,10 22,54 17,54" fill="var(--brass)" />
          <polygon points="9,10 21,10 55,54 43,54" fill="var(--brass)" />
        </g>
      </svg>
    </div>
  );
}
