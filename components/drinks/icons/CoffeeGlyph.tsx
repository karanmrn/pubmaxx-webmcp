import { baseSvgProps, type GlyphProps } from "./types";

// Coffee: a handled cup with a rising steam curl. Original IP.
export function CoffeeGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      <path d="M9 12 H21 V24 C21 26.2 19.2 28 17 28 H13 C10.8 28 9 26.2 9 24 Z" />
      <path d="M21 14 H24 C25.7 14 27 15.3 27 17 C27 18.7 25.7 20 24 20 H21" />
      <path d="M13 7 C13 5 14.5 4 14.5 2.5" opacity="0.85" />
      <path d="M17 7 C17 5 18.5 4 18.5 2.5" opacity="0.85" />
    </svg>
  );
}
