import { X } from "lucide-react";

import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

// §4.5 onboarding overlay: a dismissible "Start with a story" card that offers
// curated crawls on a clean first paint. It's the mobile onboarding (control
// rail is hidden on small screens) and never blocks the map — the backdrop and
// the link both close it. Global CSS (mapOnboarding*) is already imported by
// PubMap. Extracted verbatim from PubMap (F1); the showOnboarding guard stays
// in PubMap.
export function MapOnboardingOverlay({
  crawls,
  onLoadCrawl,
  onDismiss,
}: {
  crawls: CuratedCrawl[];
  onLoadCrawl: (crawl: CuratedCrawl) => void;
  onDismiss: () => void;
}) {
  // The scrim and the close glyph both leave. Escape now does too, so the
  // keyboard has the same way out the pointer has.
  useDismissOnEscape(true, onDismiss);
  return (
    <div
      className="mapOnboarding"
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboardingTitle"
    >
      <button
        type="button"
        className="mapOnboardingScrim"
        aria-label="Dismiss and explore the map"
        onClick={onDismiss}
      />
      <div className="mapOnboardingCard">
        <button
          type="button"
          className="mapOnboardingClose"
          onClick={onDismiss}
          aria-label="Close"
        >
          <X size={16} />
        </button>
        <p className="eyebrow">New here?</p>
        <h2 id="onboardingTitle">Start with a story</h2>
        <p className="mapOnboardingLead">
          Hand-picked crawls. One generation&rsquo;s pubs, handed to the next. Pick one to drop it
          on the map, or explore on your own.
        </p>
        <div className="mapOnboardingList">
          {crawls.map((crawl) => (
            <button
              key={crawl.id}
              type="button"
              className="mapOnboardingCrawl"
              aria-label={`Load the ${crawl.name} crawl, ${crawl.venueIds.length} stops`}
              onClick={() => onLoadCrawl(crawl)}
            >
              <span className="mapOnboardingCrawlHead">
                <strong>{crawl.name}</strong>
                <span className="mapOnboardingCount">
                  {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="mapOnboardingBlurb">{crawl.blurb}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mapOnboardingDismiss"
          onClick={onDismiss}
        >
          Dismiss / explore the map
        </button>
      </div>
    </div>
  );
}
