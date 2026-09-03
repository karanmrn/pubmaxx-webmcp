import { X } from "lucide-react";

// G3: Place story deep-link chip. Story copy wraps in full because its closing
// conditions can qualify the route; the showBandChip/activeBand guard stays in
// PubMap.
export function BandOnboardingChip({
  title,
  copy,
  onWalkStory,
  onDismiss,
}: {
  title: string;
  copy: string;
  onWalkStory: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="bandOnboardingChip" role="status" aria-live="polite">
      <div>
        <strong>{title}</strong>
        <span>{copy}</span>
      </div>
      <button type="button" onClick={onWalkStory}>
        Walk this story
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Place story intro">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
