import { baseSvgProps, type GlyphProps } from "./types";

// Beer — a pint glass with a foam head. Original IP.
export function BeerGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* glass body — slight taper to the base */}
      <path d="M9 9 L10.5 26 A1.5 1.5 0 0 0 12 27.3 L20 27.3 A1.5 1.5 0 0 0 21.5 26 L23 9 Z" />
      {/* foam head */}
      <path
        d="M9 9 Q8.5 6 11 6 Q11.5 4 14 4.5 Q16 3 18 4.5 Q21 4 21 6.5 Q23.5 6.5 23 9 Z"
        fill="currentColor"
        fillOpacity="0.16"
      />
      {/* liquid level line */}
      <path d="M9.4 12 L22.6 12" strokeWidth="1.2" opacity="0.7" />
    </svg>
  );
}
