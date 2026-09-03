export const MARK_VIEWBOX: string;

export const MARK_POLYGONS: {
  readonly thinA: string;
  readonly thinB: string;
  readonly thick: string;
};

export const MARK_SLASH_SIMPLE: string;

export const MARK_EMBER: { readonly cx: number; readonly cy: number; readonly r: number };

export const MARK_PLAQUE_RADIUS: number;

export const BRAND_COLORS: {
  readonly coral: string;
  readonly coralBright: string;
  readonly inkDeep: string;
  readonly paper: string;
};

export const ICON_TILE_FIELDS: { readonly light: string; readonly dark: string };

export const ICON_MARK_WIDTH: { readonly tile: number; readonly safeZone: number };

export const MASKABLE_SAFE_ZONE: number;

export const MARK_BOUNDS: {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
};

export const MARK_CORNER_RADIUS: number;

export function markScaleForWidth(widthFraction: number): number;

export function markFitsSafeZone(scale: number): boolean;

export function markPolygonsSvg(fill: string, options?: { simple?: boolean }): string;

export function iconTileSvg(options?: {
  field?: "light" | "dark" | string;
  radius?: number;
  widthFraction?: number;
  fill?: string;
  simple?: boolean;
  px?: number | null;
}): string;

export function iconMarkOnlySvg(options?: {
  fill?: string;
  widthFraction?: number;
  px?: number | null;
}): string;
