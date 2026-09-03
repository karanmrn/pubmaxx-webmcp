// Instant held frame while a primary-tab route's RSC/client tree arrives.
// Same paper/ink tokens as the real pages — no design change, just a skeleton
// so cold tab taps paint something within the transition budget.

import "./mobileNav.css";

type RouteLoadingShellProps = {
  /** Short status label for AT + quiet on-screen copy (e.g. "Tonight"). */
  label: string;
};

export default function RouteLoadingShell({ label }: RouteLoadingShellProps) {
  return (
    <main id="main"
      className="routeLoadingShell"
      aria-busy="true"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <div className="routeLoadingShellInner">
        <span className="routeLoadingShellBar" aria-hidden="true" />
        <span className="routeLoadingShellBar routeLoadingShellBar--short" aria-hidden="true" />
        <span className="routeLoadingShellCard" aria-hidden="true" />
        <span className="routeLoadingShellCard" aria-hidden="true" />
        <p className="routeLoadingShellLabel">{label}</p>
      </div>
    </main>
  );
}
