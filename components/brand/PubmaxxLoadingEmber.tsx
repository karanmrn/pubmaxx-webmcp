import "./pubmaxxLoadingEmber.css";
import { MARK_COLORS, MARK_GEOMETRY } from "./PubmaxxMark";

// ── The loading ember ─────────────────────────────────────────────────────────
// A breathing node: the clink's ember, held mid-glow while the app is working.
// Opacity breathes 0.6 → 1.0 over 900ms, ease-in-out, infinite alternate. It is
// the ember alone — no arms — because the mark hasn't been struck yet. Opt-in and
// tiny: drop it into any pending surface. Motion is contained to this family CSS
// and stilled under reduced motion (a steady lit ember, no pulse).

export interface PubmaxxLoadingEmberProps {
  /** Rendered pixel size. Default 16. */
  size?: number;
  /** Accessible status label; when omitted the ember is decorative. */
  label?: string;
  className?: string;
}

const node = MARK_GEOMETRY.node;

export default function PubmaxxLoadingEmber({ size = 16, label, className = "" }: PubmaxxLoadingEmberProps) {
  const labelled = Boolean(label);
  return (
    <svg
      className={`loadingEmber ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <circle className="loadingEmber__node" cx={node.cx} cy={node.cy} r={node.r} fill={MARK_COLORS.bright} />
    </svg>
  );
}
