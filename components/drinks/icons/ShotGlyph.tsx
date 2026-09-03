import { baseSvgProps, type GlyphProps } from "./types";

// Shot — a small squat shot glass with a bold liquid band. Original IP.
export function ShotGlyph({ size = 32, title, ...rest }: GlyphProps) {
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
      {/* squat glass — slight outward taper, thick base */}
      <path d="M10 11 L11 25 A1.5 1.5 0 0 0 12.5 26.3 L19.5 26.3 A1.5 1.5 0 0 0 21 25 L22 11 Z" />
      {/* full pour */}
      <path
        d="M10.6 15 L21.4 15 L21 25 A1.5 1.5 0 0 1 19.5 26.3 L12.5 26.3 A1.5 1.5 0 0 1 11 25 Z"
        fill="currentColor"
        fillOpacity="0.28"
        stroke="none"
      />
      <path d="M10.6 15 L21.4 15" strokeWidth="1.3" />
      {/* rim highlight */}
      <path d="M9.8 11 L22.2 11" strokeWidth="1.6" />
    </svg>
  );
}
