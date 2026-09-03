// One deliberate camera move, and how the canvas tells it from the last one.
//
// DEFECT (captain, live, 2026-09-01): the map header read "Piccadilly & Soho"
// while the viewport sat over rural Cumbria. Picking an area updated the chip
// and left the camera where it was.
//
// Two owners feed the canvas ONE focus prop - the opening-location answer and
// every deliberate move (the choose-area pick, the Area sheet's "go somewhere
// else", a map-search area or place select) - and each kept its OWN counter
// starting at 1, while the canvas held ONE "last applied" number. So a reader
// whose opening location had already flown at token 1 picked an area, that
// pick arrived as token 1 as well, and the canvas read it as the move it had
// already made. Nothing moved, and nothing said so.
//
// A token is an IDENTITY, not a sequence, so it carries the owner that issued
// it. Two owners can then never mint the same one, and neither has to know the
// other exists.

/** Who asked for the camera. A closed set: every owner names itself. */
export type MapCameraFocusSource = "opening-location" | "area";

export type MapCameraFocus = {
  center: [number, number];
  zoom: number;
  source: MapCameraFocusSource;
  /** Per-source counter. Only ever compared through `mapCameraFocusKey`. */
  token: number;
};

/** The identity the canvas remembers. Never a bare number. */
export function mapCameraFocusKey(focus: MapCameraFocus): string {
  return `${focus.source}:${focus.token}`;
}

/**
 * Whether this focus is a move the canvas has not made yet.
 *
 * `appliedKey` is the key of the last focus the canvas flew to, or null when it
 * has flown to none.
 */
export function mapCameraFocusMoves(
  focus: MapCameraFocus | null | undefined,
  appliedKey: string | null,
): boolean {
  if (!focus) return false;
  return mapCameraFocusKey(focus) !== appliedKey;
}
