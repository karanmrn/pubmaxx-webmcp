import { baseSvgProps, type GlyphProps } from "./types";

// Rum — a snifter / balloon glass on a short stem (dark spirit, neat). Original IP.
export function RumGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* snifter bowl — wide belly, narrower rim */}
      <path d="M11 5 L21 5 Q25 8 23.5 13 A8 8 0 0 1 8.5 13 Q7 8 11 5 Z" />
      {/* rum fill — pooled low in the belly */}
      <path
        d="M9.1 12.5 A7.5 7.5 0 0 0 22.9 12.5 A7.5 7.5 0 0 1 9.1 12.5 Z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path d="M9.6 13 A7.2 7.2 0 0 0 22.4 13" fill="currentColor" fillOpacity="0.16" stroke="none" />
      <path d="M9.6 13 A7.2 7.2 0 0 0 22.4 13" strokeWidth="1.2" opacity="0.7" />
      {/* short stem + foot */}
      <path d="M16 17.5 L16 24.5" />
      <path d="M11.5 26.5 Q16 25 20.5 26.5" />
    </svg>
  );
}
