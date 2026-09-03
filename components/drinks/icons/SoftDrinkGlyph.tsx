import { baseSvgProps, type GlyphProps } from "./types";

// Soft drink: a tall tumbler, ice, straw, and citrus slice. Original IP.
export function SoftDrinkGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      <path d="M10 9 L12 27 H22 L24 9 Z" />
      <path d="M11 15 H23" strokeWidth="1.2" opacity="0.7" />
      <path d="M17 9 L21 3" strokeWidth="1.8" />
      <path d="M14 12 L17 15 L20 12" opacity="0.75" />
      <circle cx="23.5" cy="8" r="3.2" />
      <path d="M23.5 4.8 V11.2 M20.3 8 H26.7" strokeWidth="1.1" opacity="0.75" />
    </svg>
  );
}
