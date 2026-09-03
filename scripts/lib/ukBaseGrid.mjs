// The fixed grid the UK base-pub layer is sharded on, and the pure cell maths
// the build script uses. BUILD-SIDE ONLY: the client never derives a cell — it
// reads the manifest the build emits and intersects bboxes (lib/ukBasePubs.ts),
// so this grid can be re-cut without shipping a second copy of it to the phone.
//
// Cell size is chosen against the render gate, not the data: at UK_BASE_MIN_ZOOM
// a 390x844 phone viewport is roughly 7 x 16 km, so a ~28 x ~17 km cell means a
// pan usually needs one new file and never a wide fan-out, while keeping the
// cell count (and therefore the manifest) small enough to fetch in one go.

export const SHARD_DIR_NAME = "uk_base";
export const UK_BASE_SHARD_VERSION = 1;

// Origin sits just outside the pack's bbox ([49.8, -8.7, 61, 1.9]) on both axes
// so cell boundaries are stable numbers and no pub lands on a negative index.
export const UK_BASE_GRID = {
  originLat: 49.75,
  originLon: -8.75,
  latStep: 0.25,
  lonStep: 0.25,
};

// The three cell helpers take a grid so a SECOND sharded layer can be cut on a
// finer one. The London venue layer needs that: a 0.25° cell holds a few hundred
// pubs but a few thousand pubs-plus-cafes-plus-libraries, and the per-viewport
// budget is a promise about one fetch, not about one kind. The default is the
// pub layer's own grid, so every existing caller is unchanged. The client never
// derives a cell - it reads the manifest and intersects bboxes - so a layer may
// carry its own grid without shipping a second copy of this maths to the phone.

export function cellIndexFor(lat, lon, grid = UK_BASE_GRID) {
  return {
    latIndex: Math.floor((lat - grid.originLat) / grid.latStep),
    lonIndex: Math.floor((lon - grid.originLon) / grid.lonStep),
  };
}

/**
 * How many decimals a cell id needs to tell this grid's cells apart, derived
 * from the step itself and never guessed. A 0.25° grid lands on two, and that is
 * the floor so the pub layer's existing ids do not move; a 0.025° grid needs
 * three, and formatting it to two would collapse several cells onto one id and
 * MERGE THEIR ROWS - which is a silent data loss, not a naming detail.
 */
export function cellKeyDecimals(grid = UK_BASE_GRID) {
  const decimals = (step) => {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot === -1 ? 0 : text.length - dot - 1;
  };
  return Math.max(2, decimals(grid.latStep), decimals(grid.lonStep));
}

/** South-west corner of a cell, formatted — also its file name and manifest id. */
export function cellKey(latIndex, lonIndex, grid = UK_BASE_GRID) {
  const lat = grid.originLat + latIndex * grid.latStep;
  const lon = grid.originLon + lonIndex * grid.lonStep;
  const places = cellKeyDecimals(grid);
  return `${lat.toFixed(places)}_${lon.toFixed(places)}`;
}

/** [minLng, minLat, maxLng, maxLat] — GeoJSON bbox order, as the manifest wants. */
export function cellBbox(latIndex, lonIndex, grid = UK_BASE_GRID) {
  const minLat = grid.originLat + latIndex * grid.latStep;
  const minLon = grid.originLon + lonIndex * grid.lonStep;
  return [
    Number(minLon.toFixed(4)),
    Number(minLat.toFixed(4)),
    Number((minLon + grid.lonStep).toFixed(4)),
    Number((minLat + grid.latStep).toFixed(4)),
  ];
}
