// Issue #35 — shared map skeleton. This paints both the route-level /map
// loading state and the client-side dynamic PubMap fallback, so both transitions
// use the same pitched-London held frame.
//
// It's a pitched-London impression: a softly tilted map card with a Thames curve,
// warm paper grain, and pulsing price-coloured dots (the same pint/amber/brick
// idiom the real pins use). Continued seamlessly by PubMap's own .mapLoading
// while the WebGL canvas style loads. All colour comes from existing tokens;
// reduced-motion holds the dots still (see the .mapSkeleton rules in globals).

import { mapLoadingPrimaryLine } from "@/lib/mapLoadingCopy";

// Dot positions are hand-placed to read as a loose scatter of London pubs, each
// tagged with a price bucket so the three price colours all appear. The stagger
// index drives the pulse delay so the field breathes rather than blinks in unison.
const SKELETON_DOTS: {
  x: number;
  y: number;
  bucket: "pint" | "amber" | "brick";
  delay: number;
  size?: number;
}[] = [
  { x: 74, y: 96, bucket: "pint", delay: 0, size: 5.5 },
  { x: 128, y: 72, bucket: "amber", delay: 0.2 },
  { x: 176, y: 118, bucket: "pint", delay: 0.5, size: 6 },
  { x: 214, y: 84, bucket: "brick", delay: 0.15 },
  { x: 96, y: 148, bucket: "amber", delay: 0.6 },
  { x: 158, y: 168, bucket: "pint", delay: 0.35 },
  { x: 242, y: 138, bucket: "amber", delay: 0.45, size: 5.5 },
  { x: 288, y: 104, bucket: "pint", delay: 0.25 },
  { x: 268, y: 176, bucket: "brick", delay: 0.55 },
  { x: 118, y: 118, bucket: "pint", delay: 0.7 },
  { x: 196, y: 62, bucket: "pint", delay: 0.4 },
  { x: 320, y: 150, bucket: "amber", delay: 0.3 },
  { x: 338, y: 92, bucket: "brick", delay: 0.65, size: 4.5 },
  { x: 52, y: 168, bucket: "pint", delay: 0.5, size: 4.5 },
];

const BUCKET_VAR: Record<"pint" | "amber" | "brick", string> = {
  pint: "var(--pint)",
  amber: "var(--amber)",
  brick: "var(--brick)",
};

type MapLoadingSkeletonProps = {
  /**
   * What this map is about to show. The route-level boundary cannot know it
   * (a Next loading segment takes no params), so it stays empty there and the
   * line falls back to the cityless one rather than naming the wrong city.
   */
  cityDisplayName?: string;
};

export default function MapLoadingSkeleton({
  cityDisplayName = "",
}: MapLoadingSkeletonProps) {
  return (
    <main id="main"
      className="mapSkeleton"
      aria-busy="true"
      aria-describedby="mapSkeletonStatus"
      aria-live="polite"
    >
      <div className="mapSkeletonInner">
        <svg
          className="mapSkeletonMap"
          viewBox="0 0 380 240"
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="xMidYMid slice"
        >
          <path className="mapSkeletonStreet" d="M 36 30 L 348 210" />
          <path className="mapSkeletonStreet" d="M 18 178 L 336 42" />
          <path className="mapSkeletonStreet mapSkeletonStreet--minor" d="M 86 20 L 122 226" />
          <path className="mapSkeletonStreet mapSkeletonStreet--minor" d="M 244 18 L 204 222" />
          <path className="mapSkeletonStreet mapSkeletonStreet--minor" d="M 16 82 L 364 116" />
          <path className="mapSkeletonStreet mapSkeletonStreet--minor" d="M 42 214 L 316 18" />
          <path
            className="mapSkeletonRiver"
            d="M -10 128 C 60 108, 100 150, 150 150 S 236 118, 286 132 S 360 150, 400 138"
            fill="none"
          />
          {SKELETON_DOTS.map((dot, index) => (
            <g key={index} className="mapSkeletonPin" style={{ animationDelay: `${dot.delay}s` }}>
              <circle className="mapSkeletonDotHalo" cx={dot.x} cy={dot.y} r={(dot.size ?? 5) + 6} />
              <circle
                className="mapSkeletonDot"
                cx={dot.x}
                cy={dot.y}
                r={dot.size ?? 5}
                fill={BUCKET_VAR[dot.bucket]}
              />
            </g>
          ))}
        </svg>
        <div className="mapSkeletonCopy" id="mapSkeletonStatus" role="status">
          <span aria-hidden="true" className="mapSkeletonSpinnerDot" />
          <div>
            <h1>UK venue map</h1>
            <p>{mapLoadingPrimaryLine(cityDisplayName)}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
