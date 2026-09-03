import { baseSvgProps, type GlyphProps } from "./types";

// Alcohol-free: pint silhouette with a clear zero seal. Original IP.
export function AlcoholFreeGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      <path d="M8.5 7.5 L10.5 26 A1.5 1.5 0 0 0 12 27.3 H20 A1.5 1.5 0 0 0 21.5 26 L23.5 7.5 Z" />
      <path d="M9 12 H23" strokeWidth="1.2" opacity="0.7" />
      <circle cx="17" cy="19" r="4.2" fill="currentColor" fillOpacity="0.12" />
      <circle cx="17" cy="19" r="2.1" />
      <path d="M20 16 L22.3 13.7" strokeWidth="1.6" />
    </svg>
  );
}
