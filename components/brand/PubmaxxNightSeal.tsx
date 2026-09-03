import "./pubmaxxNightSeal.css";
import PubmaxxMarkStrike from "./PubmaxxMarkStrike";

// ── The night seal ────────────────────────────────────────────────────────────
// A completed night mints a stamp: the Clink at 0.72 scale inside a 1.5px ink
// ring (r 29) with one 3px gap, the whole thing tilted -8° like a hand-pressed
// seal. It is a SANCTIONED personality surface (register: not ambient) — it
// appears only where a night is genuinely done, on the recap card, and it strikes
// on first reveal (the Strike animation runs on mount).
//
// Monochrome stamp idiom: everything is one tone. `ink` on paper, `coral` on the
// dark surface; `auto` (default) flips with the live theme token. The ring and
// the mark both wear `currentColor`, so a single instance is correct in both.

export type PubmaxxNightSealVariant = "ink" | "coral" | "auto";

export interface PubmaxxNightSealProps {
  /** Rendered pixel size (width & height of the stamp). Default 72. */
  size?: number;
  /**
   * ink   — all-ink stamp (paper / light surface).
   * coral — all-coral stamp (dark surface).
   * auto  — theme-driven: ink on light, coral on dark. Default.
   */
  variant?: PubmaxxNightSealVariant;
  /** Freeze the mark fully struck (no replay) — e.g. a seal on a profile grid. */
  still?: boolean;
  /** Accessible name; when omitted the stamp is decorative. */
  title?: string;
  className?: string;
}

// The ring: r 29 on the 64 grid. Circumference ≈ 182.21; a single 3px gap leaves
// a drawn arc of ≈179.21. Rotated so the gap sits near 41° — the broken-seal tell.
const RING_R = 29;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ≈ 182.212
const RING_GAP = 3;
const RING_DASH = `${(RING_CIRCUMFERENCE - RING_GAP).toFixed(2)} ${RING_GAP}`;

export default function PubmaxxNightSeal({
  size = 72,
  variant = "auto",
  still = false,
  title,
  className = "",
}: PubmaxxNightSealProps) {
  const labelled = Boolean(title);
  const markSize = Math.round(size * 0.72);
  const rootClass = ["nightSeal", `nightSeal--${variant}`, className].filter(Boolean).join(" ");

  return (
    <span
      className={rootClass}
      style={{ ["--seal-size" as string]: `${size}px` }}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      <svg className="nightSeal__ring" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
        <circle
          cx="32"
          cy="32"
          r={RING_R}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray={RING_DASH}
          transform="rotate(41 32 32)"
        />
      </svg>
      <PubmaxxMarkStrike className="nightSeal__mark" variant="mono" monoEmber size={markSize} still={still} />
    </span>
  );
}
