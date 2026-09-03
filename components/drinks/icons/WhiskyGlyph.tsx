import { baseSvgProps, type GlyphProps } from "./types";

// Whisky — a short tumbler / rocks glass with a single ice cube. Original IP.
export function WhiskyGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* tumbler — heavy-based, wider than tall */}
      <path d="M8 10 L9 25 A1.5 1.5 0 0 0 10.5 26.3 L21.5 26.3 A1.5 1.5 0 0 0 23 25 L24 10 Z" />
      {/* whisky fill */}
      <path
        d="M8.6 16 L23.4 16 L23 25 A1.5 1.5 0 0 1 21.5 26.3 L10.5 26.3 A1.5 1.5 0 0 1 9 25 Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="none"
      />
      <path d="M8.6 16 L23.4 16" strokeWidth="1.2" opacity="0.7" />
      {/* ice cube */}
      <rect
        x="13.5"
        y="18"
        width="5"
        height="5"
        rx="1"
        transform="rotate(-8 16 20.5)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
