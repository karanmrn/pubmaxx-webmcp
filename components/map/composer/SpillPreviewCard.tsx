import { Camera } from "lucide-react";

import type { Visibility } from "@/lib/spill";
import type { SpillPreviewModel } from "@/lib/spillPreview";
import { VISIBILITY_COPY } from "@/lib/pintDropComposerConfig";
import type { PintDropsState } from "@/components/map/usePintDrops";

type SpillPreviewCardProps = {
  preview: SpillPreviewModel;
  pintPhoto: PintDropsState["pintPhoto"];
  visibility: Visibility;
};

// ── Instant preview card (PRD priority 2) ──────────────────────────
//   A live, client-only render styled like the final 9:16 feedSpill card
//   — photo (or a candle-lit placeholder), price stamp, provenance
//   badge, and the handle scrim. Provenance is derived exactly as the
//   server derives it, never flattened.
export function SpillPreviewCard({ preview, pintPhoto, visibility }: SpillPreviewCardProps) {
  return (
    <div className="spillPreviewWrap" aria-hidden="true">
      <span className="spillPreviewEyebrow">Live preview</span>
      <div className={`spillPreviewCard${preview.hasPhoto ? " hasPhoto" : ""}`}>
        {preview.hasPhoto && pintPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="spillPreviewPhoto"
            src={pintPhoto.previewUrl}
            alt=""
            decoding="async"
          />
        ) : (
          <div className="spillPreviewPlaceholder">
            <Camera size={26} />
            <span>Your shot lands here</span>
          </div>
        )}
        <div className="spillPreviewStamps">
          <span className={`spillPreviewProv feedProv-${preview.provenance}`}>
            {preview.provenanceLabel}
          </span>
          <span className="spillPreviewVisibility">{VISIBILITY_COPY[visibility].label}</span>
        </div>
        {preview.priceLabel ? (
          <span className="spillPreviewPrice">{preview.priceLabel}</span>
        ) : null}
        <div className="spillPreviewScrim">
          <div className="spillPreviewWho">
            <span className="spillPreviewAvatar">{preview.initial}</span>
            <div className="spillPreviewWhoText">
              <span className="spillPreviewHandle">{preview.shownHandle}</span>
              <span className="spillPreviewMeta">{preview.venueName}</span>
            </div>
          </div>
          {preview.note ? <p className="spillPreviewNote">{preview.note}</p> : null}
        </div>
      </div>
    </div>
  );
}
