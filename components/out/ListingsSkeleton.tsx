import "./listingsSkeleton.css";

const LOADING_LABEL = "Loading listings";

export default function ListingsSkeleton() {
  return (
    <div
      className="listingsSkeleton"
      data-testid="listings-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="listingsSkeletonLabel">{LOADING_LABEL}</span>
      <div className="listingsSkeletonCard" aria-hidden="true">
        <span className="listingsSkeletonTitle" />
        <span className="listingsSkeletonMeta" />
      </div>
      <div className="listingsSkeletonCard" aria-hidden="true">
        <span className="listingsSkeletonTitle" />
        <span className="listingsSkeletonMeta" />
      </div>
      <div className="listingsSkeletonCard" aria-hidden="true">
        <span className="listingsSkeletonTitle" />
        <span className="listingsSkeletonMeta" />
      </div>
    </div>
  );
}
