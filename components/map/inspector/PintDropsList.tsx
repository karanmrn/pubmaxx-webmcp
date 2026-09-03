import VenueImage from "@/components/media/VenueImage";
import { ProvenanceChip } from "@/components/map/venueInspectorBits";
import { Flag } from "lucide-react";

import { formatPrice, type Venue } from "@/lib/venues";
import { lastTrainBadge } from "@/lib/lastTrainBadge";
import type { LastPintDecision } from "@/lib/tfl";
import type { DropWithPhotos, PintDropsState } from "@/components/map/usePintDrops";

export default function PintDropsList({
  venue,
  drops,
  lastTrainDecision,
  reportDrop,
}: {
  venue: Venue;
  drops: DropWithPhotos[];
  lastTrainDecision: LastPintDecision | null;
  reportDrop: PintDropsState["reportDrop"];
}) {
  return (
    <div className="dropList">
      {drops.map((drop) => {
        const hasPhotos = Boolean(drop.pintPhotoUrl || drop.venuePhotoUrl);
        // Honest transport-context stamp (IDEAS A5 / Wave G1): prefer
        // fields captured on the drop at compose time; fall back to the
        // live Getting-home session for older rows that never stored them.
        // See lib/lastTrainBadge.ts — no live kind / leave-by → no badge.
        const trainBadge = lastTrainBadge(
          drop.createdAt,
          drop.leaveByIso ?? lastTrainDecision?.leaveByIso,
          drop.lastTrainDecision ?? lastTrainDecision?.decision,
        );
        return (
          <article
            key={drop.id}
            className={hasPhotos ? "dropCard instaPint" : "dropCard"}
          >
            <div className="dropHead">
              <span className="dropHandle">{drop.handle}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                {drop.priceGbp !== null ? (
                  <span className="dropPrice">{formatPrice(drop.priceGbp)}</span>
                ) : null}
                <ProvenanceChip provenance={drop.provenance} />
              </span>
            </div>
            {/* InstaPint: the pint + the cheeky bar selfie shown as a
                framed image pair (Instagram-ish), the note/tags below as a
                caption. A single photo fills the frame; a drop with no
                photo still reads fine as a text card (the block is skipped). */}
            {hasPhotos ? (
              <div className="instaFrame">
                {drop.pintPhotoUrl ? (
                  <figure className="instaShot">
                    <VenueImage
                      className="dropPhoto"
                      sources={[{ url: drop.pintPhotoUrl, provenance: "community" }]}
                      alt={`Pint at ${venue.name} shared by ${drop.handle}`}
                      width={480}
                      height={480}
                    />
                    <figcaption>the pint</figcaption>
                  </figure>
                ) : null}
                {drop.venuePhotoUrl ? (
                  <figure className="instaShot">
                    <VenueImage
                      className="dropPhoto"
                      sources={[{ url: drop.venuePhotoUrl, provenance: "community" }]}
                      alt={`${drop.handle} at the bar at ${venue.name}`}
                      width={480}
                      height={480}
                    />
                    <figcaption>at the bar</figcaption>
                  </figure>
                ) : null}
              </div>
            ) : null}
            {drop.passedDownNote ? (
              <p className="dropCaption">{drop.passedDownNote}</p>
            ) : null}
            {drop.vibeTags && drop.vibeTags.length > 0 ? (
              <div className="dropVibeTags">
                {drop.vibeTags.map((tag) => (
                  <span key={tag} className="vibeChip small">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="dropFoot">
              <small>
                {[drop.drink, drop.era].filter(Boolean).join(" · ") || "Visit report"}
                {trainBadge ? (
                  <span className="trainBadge" data-tone={trainBadge.tone}>
                    {trainBadge.label}
                  </span>
                ) : null}
              </small>
              {drop.provenance !== "demo" ? (
                <button
                  type="button"
                  className="reportBtn"
                  onClick={() => reportDrop(venue.id, drop.id)}
                  aria-label={`Report Pint Drop by ${drop.handle}`}
                >
                  <Flag size={12} /> Report
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
