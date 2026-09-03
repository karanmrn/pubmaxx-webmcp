import { baseSvgProps, type GlyphProps } from "./types";

// Gin — a stemmed copa/balloon glass with a botanical sprig. Original IP.
export function GinGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* balloon bowl — round with a pinched rim */}
      <path d="M11 4 L21 4 Q24 6 23 10 A7 7 0 0 1 9 10 Q8 6 11 4 Z" />
      {/* fill */}
      <path
        d="M9.4 10.5 A6.6 6.6 0 0 0 22.6 10.5 A6.6 6.6 0 0 1 9.4 10.5 Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path d="M9.6 11 A6.5 6.5 0 0 0 22.4 11" fill="currentColor" fillOpacity="0.14" stroke="none" />
      <path d="M9.6 11 A6.5 6.5 0 0 0 22.4 11" strokeWidth="1.2" opacity="0.7" />
      {/* stem + foot */}
      <path d="M16 15 L16 25" />
      <path d="M12 27 Q16 25.5 20 27" />
      {/* botanical sprig */}
      <path d="M16 4 Q16 1.5 18.5 1.5" strokeWidth="1.2" />
      <path d="M17.2 2.4 L18.6 1.6 M17.2 2.4 L18 3.6" strokeWidth="1.2" />
    </svg>
  );
}
