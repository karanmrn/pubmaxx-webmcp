import { baseSvgProps, type GlyphProps } from "./types";

// Vodka — a tall, straight shot / highball glass, clean and icy. Original IP.
export function VodkaGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* tall narrow glass — a shooter */}
      <path d="M11 5 L11.7 26 A1.4 1.4 0 0 0 13.1 27.3 L18.9 27.3 A1.4 1.4 0 0 0 20.3 26 L21 5 Z" />
      {/* clear fill, filled high */}
      <path
        d="M11.25 10 L20.75 10 L20.3 26 A1.4 1.4 0 0 1 18.9 27.3 L13.1 27.3 A1.4 1.4 0 0 1 11.7 26 Z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="none"
      />
      <path d="M11.25 10 L20.75 10" strokeWidth="1.2" opacity="0.7" />
      {/* frost sparkle */}
      <path d="M15 15 L15 17 M14 16 L16 16" strokeWidth="1.1" opacity="0.7" />
    </svg>
  );
}
