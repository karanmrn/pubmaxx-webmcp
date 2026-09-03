import { baseSvgProps, type GlyphProps } from "./types";

// Other — a generic bottle, the honest catch-all (cider, liqueur, aperitif).
// Original IP.
export function OtherGlyph({ size = 32, title, ...rest }: GlyphProps) {
  const decorative = !title;
  return (
    <svg
      {...baseSvgProps(size)}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {/* neck + shoulder + body */}
      <path d="M14 3 L18 3 L18 8 Q21 10 21 14 L21 26 A1.5 1.5 0 0 1 19.5 27.5 L12.5 27.5 A1.5 1.5 0 0 1 11 26 L11 14 Q11 10 14 8 Z" />
      {/* cap */}
      <path d="M14 3 L18 3" strokeWidth="1.8" />
      {/* label band */}
      <path d="M11 16 L21 16 M11 21 L21 21" strokeWidth="1.1" opacity="0.7" />
      <path d="M11 16 L21 16 L21 21 L11 21 Z" fill="currentColor" fillOpacity="0.14" stroke="none" />
    </svg>
  );
}
