import { HandCoins } from "lucide-react";

// Skeleton shown while the real PintDropStrip lazy-loads. It mirrors the loaded
// strip's outer shape exactly — the same .dropStripHead (eyebrow + hint) and a
// four-card rail — so the section does not jump height/layout when the real
// component swaps in. Purely decorative, so the whole block is aria-hidden.
export default function PintDropStripLoading() {
  return (
    <div className="dropStrip" aria-hidden="true">
      <div className="dropStripHead">
        <p className="eyebrow">
          <HandCoins size={15} strokeWidth={1.5} aria-hidden="true" />
          Fresh from the taps
        </p>
        <span className="dropStripHint">Newest community drops →</span>
      </div>
      <div className="dropStripRail">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="dropStripCard dropStripCardSkeleton" key={index}>
            <span className="skelLine skelLineTop" />
            <span className="skelLine" />
            <span className="skelLine skelLineShort" />
          </div>
        ))}
      </div>
    </div>
  );
}
