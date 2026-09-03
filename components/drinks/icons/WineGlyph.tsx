import { baseSvgProps, type GlyphProps } from "./types";

// Wine — a stemmed wine glass with a filled bowl. Original IP.
export function WineGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* bowl */}
      <path d="M10 4 L22 4 Q22 13 16 15 Q10 13 10 4 Z" />
      {/* wine fill */}
      <path
        d="M10.6 8 L21.4 8 Q21 13 16 14.4 Q11 13 10.6 8 Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      {/* stem + foot */}
      <path d="M16 15 L16 25" />
      <path d="M11 27 L21 27" />
      <path d="M16 25 Q16 27 12.5 27" opacity="0" />
      <path d="M12.5 27 Q16 25.5 19.5 27" />
    </svg>
  );
}
