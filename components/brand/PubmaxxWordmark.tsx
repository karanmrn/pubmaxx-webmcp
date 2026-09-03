import "./pubmaxxWordmark.css";
import { BRAND_NAME } from "@/lib/brandNaming";
import PubmaxxMark, { type PubmaxxMarkVariant } from "./PubmaxxMark";

export interface PubmaxxWordmarkProps {
  className?: string;
  /**
   * Show the Crossing mark locked up to the left of the wordmark. Off by
   * default so existing inline usages (nav, landing, chooser) are unchanged.
   * Spacing is governed by `.pubmaxxLockup` — the gap tracks the wordmark's
   * font-size (0.42em) so the lockup scales as one unit.
   */
  withMark?: boolean;
  /** Variant for the locked-up mark. Default "duo". Ignored unless withMark. */
  markVariant?: PubmaxxMarkVariant;
  /** Mark size in px. Default 1.05× the cap height reads best; tune per host. */
  markSize?: number;
}

export default function PubmaxxWordmark({
  className = "",
  withMark = false,
  markVariant = "duo",
  markSize = 22,
}: PubmaxxWordmarkProps) {
  const word = (
    <span
      className={`pubmaxxWordmark ${withMark ? "" : className}`.trim()}
      role="img"
      aria-label={BRAND_NAME}
    >
      <span className="pubmaxxWordmarkSr">{BRAND_NAME}</span>
      <span className="pubmaxxWordmarkLetters" aria-hidden="true">
        <span>PUBMAX</span>
        <span className="pubmaxxWordmarkAccent">X</span>
      </span>
    </span>
  );

  if (!withMark) return word;

  return (
    <span className={`pubmaxxLockup ${className}`.trim()}>
      <PubmaxxMark variant={markVariant} size={markSize} />
      {word}
    </span>
  );
}
