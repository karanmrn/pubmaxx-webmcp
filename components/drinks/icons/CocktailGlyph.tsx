import { baseSvgProps, type GlyphProps } from "./types";

// Cocktail — a martini/coupe on a stem with a garnish pick. Original IP.
export function CocktailGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* V-shaped cocktail bowl */}
      <path d="M6 6 L26 6 L16 16 Z" />
      {/* drink fill */}
      <path d="M9 8.4 L23 8.4 L16 15.4 Z" fill="currentColor" fillOpacity="0.2" stroke="none" />
      <path d="M9 8.4 L23 8.4" strokeWidth="1.2" opacity="0.7" />
      {/* stem + foot */}
      <path d="M16 16 L16 25" />
      <path d="M11 27 L21 27" />
      {/* garnish pick + cherry */}
      <path d="M18 6 L22.5 2" strokeWidth="1.2" />
      <circle cx="22.6" cy="2" r="1.3" fill="currentColor" fillOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}
