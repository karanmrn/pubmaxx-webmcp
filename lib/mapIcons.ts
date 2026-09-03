// Designed marker icons for the MapLibre GL basemap. Two families live here:
//
//   1. "lm" — recognizable London-landmark pictograms drawn in a chunky, slightly
//      "toy brick" silhouette style (Big Ben, St Paul's, Tower Bridge, …). These
//      are theme-tinted so they read on both a dark and a light basemap.
//   2. "tfl" — faithful reproductions of Transport for London / National Rail
//      wayfinding marks (Underground roundel, National Rail double-arrow, London
//      bus roundel, river-bus pier). These use FIXED brand hex codes because they
//      are registered trademarks used here purely as wayfinding symbols — they are
//      NOT theme-tinted (only the pad/outline behind them adapts to the basemap).
//
// The module is pure aside from `rasterize`, which is the only browser-only export
// (it touches `document`). Every icon's artwork lives in a `draw(ctx, tokens)`
// callback that works in a plain 0..size CSS-pixel coordinate space, so the drawing
// code is trivially exercisable in tests with a recording stub context — no real
// canvas required. The caller applies the pixelRatio scale before calling `draw`.

// Theme colours passed in by the caller (read from CSS tokens at runtime). Keeping
// them as plain hex/colour strings means `draw` stays a pure function of its args.
export type IconTokens = {
  ink: string; // dark foreground
  paper: string; // light background/paper
  brass: string; // primary accent
  brassBright: string; // bright accent
  river: string; // muted blue
  riverBright: string; // bright blue
  /** Price-band fills for drink pins (optional — landmarks/TfL ignore these). */
  pint?: string;
  amber?: string;
  brick?: string;
  muted?: string;
  /**
   * The drink pin's rim, and the opposite-luminance casing just outside it.
   * Both optional: a theme that omits them keeps the plain per-band rim below
   * (see makeVenuePinDraw). The dark theme sets both because its basemap is
   * bimodal in luminance — near-black land against near-white road strokes —
   * so no single rim tone can edge a pin on both. See the comment on
   * `venuePinEdgeTokens` in components/map/canvas/tokens.ts.
   */
  pinRim?: string;
  pinCasing?: string;
};

export type IconNamespace = "lm" | "tfl" | "drink" | "base";

export type IconSpec = {
  key: string; // e.g. "clock-tower", "underground", "pint-0"
  ns: IconNamespace; // "lm" | "tfl" | "drink"
  size: number; // intended CSS px of the icon box (e.g. 30)
  // Draw into a size×size box in CSS-pixel coordinates (the caller applies the
  // pixelRatio scale before calling draw, so draw uses 0..size coords).
  draw: (ctx: CanvasRenderingContext2D, t: IconTokens) => void;
};

// ---------------------------------------------------------------------------
// Fixed TfL / National Rail brand colours.
//
// These are the official brand hex codes for the transport marks below. They are
// reproduced faithfully here as wayfinding symbols; the Underground roundel, the
// National Rail double-arrow, the London bus roundel and the river-bus mark are
// registered trademarks of Transport for London / the relevant rights holders.
// They are intentionally NOT tinted by IconTokens — only the pad/outline behind a
// mark uses the theme so it sits cleanly on either a dark or a light basemap.
// ---------------------------------------------------------------------------
const TFL_RED = "#DC241F"; // Underground roundel ring + London bus disc
const TFL_BLUE = "#10069F"; // Underground roundel bar
const RAIL_RED = "#E30613"; // National Rail double-arrow
const RIVER_BLUE = "#009FDF"; // TfL river-bus blue
const WHITE = "#FFFFFF";

// The intended on-map box for every icon. All artwork is authored against this so
// the silhouettes stay visually consistent; the caller can still scale on display.
const BOX = 30;

// Stroke width used for the chunky landmark outlines/joins. Proportional to the box
// so the silhouettes keep their weight if BOX ever changes. ~6% reads well at the
// 24–34px the icons render at on the map.
const STROKE = BOX * 0.06;

// ---------------------------------------------------------------------------
// Shared private draw helpers. Kept module-private and dependency-free so every
// icon composes from the same primitives (and the tests can prove no draw throws).
// ---------------------------------------------------------------------------

// Rounded-rect path. Falls back to a plain rect when the (older) roundRect API is
// unavailable so the module never assumes a specific canvas implementation.
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  // Manual rounded rect for environments without CanvasRenderingContext2D.roundRect.
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// The soft rounded pad every icon sits on. A near-circular paper disc with a thin
// ink ring gives the marks something to read against on ANY basemap colour — this
// is what makes both the tinted landmarks and the brand marks legible on dark maps.
function drawPad(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: IconTokens,
): void {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - STROKE * 0.6;
  ctx.save();
  ctx.fillStyle = t.paper;
  ctx.strokeStyle = t.ink;
  ctx.lineWidth = STROKE * 0.7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Apply the shared chunky landmark styling: filled silhouette in the accent colour
// with a crisp ink outline and rounded joins. `bright` picks the brighter accent.
function setLandmarkStyle(
  ctx: CanvasRenderingContext2D,
  t: IconTokens,
  bright: boolean,
): void {
  ctx.fillStyle = bright ? t.brassBright : t.brass;
  ctx.strokeStyle = t.ink;
  ctx.lineWidth = STROKE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

// Fill then stroke the current path — the two-step that gives every landmark its
// silhouette-plus-outline look. Kept as one helper so the order never drifts.
function fillStroke(ctx: CanvasRenderingContext2D): void {
  ctx.fill();
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Landmark pictograms (ns: "lm"). Each draws its pad first, then a chunky,
// glance-recognizable silhouette centred in the box with a couple px of padding.
// ---------------------------------------------------------------------------

// Big Ben / Elizabeth Tower: a tall narrow tower, a clock-face circle near the top,
// topped by a pointed spire.
function drawClockTower(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const bodyW = BOX * 0.26;
  const bodyTop = BOX * 0.32;
  const bodyBottom = BOX * 0.82;
  // Tower shaft.
  roundRectPath(
    ctx,
    cx - bodyW / 2,
    bodyTop,
    bodyW,
    bodyBottom - bodyTop,
    BOX * 0.03,
  );
  fillStroke(ctx);
  // Pointed spire.
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, bodyTop);
  ctx.lineTo(cx, BOX * 0.14);
  ctx.lineTo(cx + bodyW / 2, bodyTop);
  ctx.closePath();
  fillStroke(ctx);
  // Clock face near the top of the shaft.
  ctx.beginPath();
  ctx.fillStyle = t.paper;
  ctx.arc(cx, bodyTop + BOX * 0.12, BOX * 0.08, 0, Math.PI * 2);
  fillStroke(ctx);
}

// St Paul's: a wide dome carrying a small cross/lantern, over a colonnade base.
function drawDome(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const baseTop = BOX * 0.62;
  const baseW = BOX * 0.5;
  // Colonnade base block.
  roundRectPath(ctx, cx - baseW / 2, baseTop, baseW, BOX * 0.2, BOX * 0.03);
  fillStroke(ctx);
  // Dome (half circle).
  ctx.beginPath();
  ctx.arc(cx, baseTop, BOX * 0.22, Math.PI, 0);
  ctx.closePath();
  fillStroke(ctx);
  // Lantern + cross on top.
  roundRectPath(
    ctx,
    cx - BOX * 0.05,
    BOX * 0.28,
    BOX * 0.1,
    BOX * 0.12,
    BOX * 0.02,
  );
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.18);
  ctx.lineTo(cx, BOX * 0.3);
  ctx.moveTo(cx - BOX * 0.05, BOX * 0.23);
  ctx.lineTo(cx + BOX * 0.05, BOX * 0.23);
  ctx.stroke();
}

// Tower Bridge: two square towers joined by a horizontal deck with a suspension
// curve slung between them.
function drawTwinTowers(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const towerW = BOX * 0.18;
  const towerTop = BOX * 0.26;
  const towerBottom = BOX * 0.8;
  const leftX = BOX * 0.26;
  const rightX = BOX * 0.74;
  // Deck between the towers.
  const deckY = BOX * 0.5;
  roundRectPath(
    ctx,
    leftX - towerW / 2,
    deckY,
    rightX - leftX + towerW,
    BOX * 0.08,
    BOX * 0.02,
  );
  fillStroke(ctx);
  // Two towers with little pointed caps.
  for (const x of [leftX, rightX]) {
    roundRectPath(
      ctx,
      x - towerW / 2,
      towerTop,
      towerW,
      towerBottom - towerTop,
      BOX * 0.02,
    );
    fillStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(x - towerW / 2, towerTop);
    ctx.lineTo(x, BOX * 0.18);
    ctx.lineTo(x + towerW / 2, towerTop);
    ctx.closePath();
    fillStroke(ctx);
  }
  // Suspension curve dipping below the deck.
  ctx.beginPath();
  ctx.moveTo(leftX, deckY);
  ctx.quadraticCurveTo(BOX / 2, deckY + BOX * 0.16, rightX, deckY);
  ctx.stroke();
}

// The Shard: a tall tapered glass spike — a narrow, slightly asymmetric sliver.
function drawShard(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.12); // pinched tip
  ctx.lineTo(cx + BOX * 0.14, BOX * 0.82);
  ctx.lineTo(cx - BOX * 0.12, BOX * 0.82);
  ctx.closePath();
  fillStroke(ctx);
  // A couple of faceting lines up the sliver for the glass read.
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.12);
  ctx.lineTo(cx + BOX * 0.02, BOX * 0.8);
  ctx.stroke();
}

// London Eye: a spoked wheel over a small base.
function drawWheel(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const cy = BOX * 0.44;
  const r = BOX * 0.28;
  // Rim.
  ctx.beginPath();
  ctx.fillStyle = t.paper;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  fillStroke(ctx);
  // Hub.
  ctx.beginPath();
  ctx.fillStyle = t.brassBright;
  ctx.arc(cx, cy, BOX * 0.05, 0, Math.PI * 2);
  fillStroke(ctx);
  // Spokes.
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
  // Little A-frame base.
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.12, BOX * 0.82);
  ctx.lineTo(cx, cy + r * 0.4);
  ctx.lineTo(cx + BOX * 0.12, BOX * 0.82);
  ctx.stroke();
}

// The Gherkin (30 St Mary Axe): a rounded bullet/egg tower with a diagonal
// crosshatch grid to echo its lattice facade.
function drawGherkin(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const top = BOX * 0.16;
  const bottom = BOX * 0.82;
  const halfW = BOX * 0.16;
  // Bullet silhouette: rounded tip, bulging middle, tucked base.
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(
    cx + halfW * 1.4,
    BOX * 0.4,
    cx + halfW,
    bottom,
    cx,
    bottom,
  );
  ctx.bezierCurveTo(cx - halfW, bottom, cx - halfW * 1.4, BOX * 0.4, cx, top);
  ctx.closePath();
  fillStroke(ctx);
  // Diagonal crosshatch clipped to the silhouette.
  ctx.save();
  ctx.clip();
  ctx.lineWidth = STROKE * 0.5;
  ctx.beginPath();
  for (let o = -BOX; o < BOX; o += BOX * 0.12) {
    ctx.moveTo(cx - halfW * 1.6 + o, bottom);
    ctx.lineTo(cx - halfW * 1.6 + o + BOX * 0.6, top);
    ctx.moveTo(cx + halfW * 1.6 - o, bottom);
    ctx.lineTo(cx + halfW * 1.6 - o - BOX * 0.6, top);
  }
  ctx.stroke();
  ctx.restore();
}

// Nelson's Column / The Monument: a slender column on a stepped base with a cap.
function drawColumn(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const shaftW = BOX * 0.12;
  // Shaft.
  roundRectPath(
    ctx,
    cx - shaftW / 2,
    BOX * 0.28,
    shaftW,
    BOX * 0.42,
    BOX * 0.02,
  );
  fillStroke(ctx);
  // Capital + statue cap.
  roundRectPath(
    ctx,
    cx - shaftW * 0.9,
    BOX * 0.22,
    shaftW * 1.8,
    BOX * 0.07,
    BOX * 0.02,
  );
  fillStroke(ctx);
  ctx.beginPath();
  ctx.arc(cx, BOX * 0.17, BOX * 0.05, 0, Math.PI * 2);
  fillStroke(ctx);
  // Stepped base (two widening blocks).
  roundRectPath(
    ctx,
    cx - shaftW,
    BOX * 0.7,
    shaftW * 2,
    BOX * 0.06,
    BOX * 0.01,
  );
  fillStroke(ctx);
  roundRectPath(
    ctx,
    cx - shaftW * 1.5,
    BOX * 0.76,
    shaftW * 3,
    BOX * 0.07,
    BOX * 0.01,
  );
  fillStroke(ctx);
}

// Generic grand civic building (museums / halls): a pediment triangle over a row
// of columns.
function drawCivic(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const halfW = BOX * 0.3;
  const roofY = BOX * 0.42;
  // Pediment triangle.
  ctx.beginPath();
  ctx.moveTo(cx - halfW, roofY);
  ctx.lineTo(cx, BOX * 0.2);
  ctx.lineTo(cx + halfW, roofY);
  ctx.closePath();
  fillStroke(ctx);
  // Architrave band.
  roundRectPath(ctx, cx - halfW, roofY, halfW * 2, BOX * 0.07, BOX * 0.01);
  fillStroke(ctx);
  // Columns.
  const colTop = roofY + BOX * 0.07;
  const colBottom = BOX * 0.78;
  const colW = BOX * 0.07;
  for (let i = 0; i < 4; i += 1) {
    const x = cx - halfW * 0.75 + (i * (halfW * 1.5)) / 3;
    roundRectPath(
      ctx,
      x - colW / 2,
      colTop,
      colW,
      colBottom - colTop,
      BOX * 0.01,
    );
    fillStroke(ctx);
  }
  // Ground step.
  roundRectPath(
    ctx,
    cx - halfW * 1.05,
    colBottom,
    halfW * 2.1,
    BOX * 0.06,
    BOX * 0.01,
  );
  fillStroke(ctx);
}

// Tower of London: a square Norman keep with four corner turrets.
function drawKeep(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const bodyW = BOX * 0.44;
  const bodyTop = BOX * 0.34;
  const bodyBottom = BOX * 0.8;
  // Keep body.
  roundRectPath(
    ctx,
    cx - bodyW / 2,
    bodyTop,
    bodyW,
    bodyBottom - bodyTop,
    BOX * 0.03,
  );
  fillStroke(ctx);
  // Four corner turrets poking above the body.
  const turretW = BOX * 0.1;
  const turretTop = BOX * 0.24;
  for (const x of [cx - bodyW / 2, cx + bodyW / 2 - turretW]) {
    roundRectPath(
      ctx,
      x,
      turretTop,
      turretW,
      bodyTop - turretTop + BOX * 0.04,
      BOX * 0.02,
    );
    fillStroke(ctx);
    // Little pointed cap on each turret.
    ctx.beginPath();
    ctx.moveTo(x, turretTop);
    ctx.lineTo(x + turretW / 2, BOX * 0.18);
    ctx.lineTo(x + turretW, turretTop);
    ctx.closePath();
    fillStroke(ctx);
  }
  // Doorway hint.
  roundRectPath(
    ctx,
    cx - BOX * 0.05,
    bodyBottom - BOX * 0.16,
    BOX * 0.1,
    BOX * 0.16,
    BOX * 0.04,
  );
  ctx.fillStyle = t.paper;
  fillStroke(ctx);
}

// Market / hall (e.g. Borough Market): a gabled roofline with a stall awning.
function drawMarket(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const halfW = BOX * 0.32;
  const eaveY = BOX * 0.42;
  const wallBottom = BOX * 0.8;
  // Gabled roof.
  ctx.beginPath();
  ctx.moveTo(cx - halfW, eaveY);
  ctx.lineTo(cx, BOX * 0.24);
  ctx.lineTo(cx + halfW, eaveY);
  ctx.closePath();
  fillStroke(ctx);
  // Walls.
  roundRectPath(
    ctx,
    cx - halfW * 0.8,
    eaveY,
    halfW * 1.6,
    wallBottom - eaveY,
    BOX * 0.02,
  );
  fillStroke(ctx);
  // Scalloped awning across the front.
  ctx.beginPath();
  const awnY = BOX * 0.6;
  const awnLeft = cx - halfW * 0.8;
  const awnRight = cx + halfW * 0.8;
  ctx.moveTo(awnLeft, awnY);
  const scallops = 3;
  for (let i = 0; i < scallops; i += 1) {
    const x0 = awnLeft + ((awnRight - awnLeft) * i) / scallops;
    const x1 = awnLeft + ((awnRight - awnLeft) * (i + 1)) / scallops;
    ctx.quadraticCurveTo((x0 + x1) / 2, awnY + BOX * 0.08, x1, awnY);
  }
  ctx.stroke();
}

// Camden Lock: a little humped bridge arch over horizontal water lines.
function drawCanal(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const deckY = BOX * 0.44;
  const spanHalf = BOX * 0.3;
  // Bridge deck as a shallow hump.
  ctx.beginPath();
  ctx.moveTo(cx - spanHalf, deckY);
  ctx.quadraticCurveTo(cx, deckY - BOX * 0.14, cx + spanHalf, deckY);
  ctx.lineTo(cx + spanHalf, deckY + BOX * 0.08);
  ctx.quadraticCurveTo(
    cx,
    deckY - BOX * 0.06,
    cx - spanHalf,
    deckY + BOX * 0.08,
  );
  ctx.closePath();
  fillStroke(ctx);
  // Arch opening under the hump.
  ctx.beginPath();
  ctx.fillStyle = t.paper;
  ctx.moveTo(cx - BOX * 0.14, deckY + BOX * 0.08);
  ctx.quadraticCurveTo(
    cx,
    deckY - BOX * 0.02,
    cx + BOX * 0.14,
    deckY + BOX * 0.08,
  );
  ctx.closePath();
  fillStroke(ctx);
  // Water lines below.
  ctx.strokeStyle = t.riverBright;
  ctx.beginPath();
  for (let i = 0; i < 2; i += 1) {
    const y = BOX * 0.62 + i * BOX * 0.1;
    ctx.moveTo(cx - spanHalf, y);
    ctx.quadraticCurveTo(cx - spanHalf / 2, y + BOX * 0.04, cx, y);
    ctx.quadraticCurveTo(cx + spanHalf / 2, y - BOX * 0.04, cx + spanHalf, y);
  }
  ctx.stroke();
}

// Cutty Sark / Greenwich: a three-mast sailing-ship silhouette over a hull.
function drawShip(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  // Hull.
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.3, BOX * 0.64);
  ctx.lineTo(cx + BOX * 0.3, BOX * 0.64);
  ctx.lineTo(cx + BOX * 0.2, BOX * 0.78);
  ctx.lineTo(cx - BOX * 0.2, BOX * 0.78);
  ctx.closePath();
  fillStroke(ctx);
  // Three masts.
  ctx.beginPath();
  for (const x of [cx - BOX * 0.18, cx, cx + BOX * 0.18]) {
    ctx.moveTo(x, BOX * 0.22);
    ctx.lineTo(x, BOX * 0.64);
  }
  ctx.stroke();
  // A billowing sail on the centre mast.
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.26);
  ctx.quadraticCurveTo(cx + BOX * 0.16, BOX * 0.4, cx, BOX * 0.58);
  ctx.lineTo(cx - BOX * 0.01, BOX * 0.58);
  ctx.quadraticCurveTo(cx - BOX * 0.14, BOX * 0.42, cx, BOX * 0.26);
  ctx.closePath();
  ctx.fillStyle = t.paper;
  fillStroke(ctx);
}

// Battersea Power Station: a rectangular block with four tall chimneys.
function drawChimneys(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  setLandmarkStyle(ctx, t, true);
  const cx = BOX / 2;
  const bodyW = BOX * 0.5;
  const bodyTop = BOX * 0.5;
  const bodyBottom = BOX * 0.8;
  // Main block.
  roundRectPath(
    ctx,
    cx - bodyW / 2,
    bodyTop,
    bodyW,
    bodyBottom - bodyTop,
    BOX * 0.02,
  );
  fillStroke(ctx);
  // Four chimneys standing on the corners of the block.
  const chW = BOX * 0.07;
  const chTop = BOX * 0.24;
  const inset = BOX * 0.06;
  const xs = [
    cx - bodyW / 2 + inset,
    cx - bodyW / 6,
    cx + bodyW / 6 - chW,
    cx + bodyW / 2 - inset - chW,
  ];
  for (const x of xs) {
    roundRectPath(ctx, x, chTop, chW, bodyTop - chTop + BOX * 0.02, BOX * 0.01);
    fillStroke(ctx);
  }
}

// ---------------------------------------------------------------------------
// TfL / National Rail symbols (ns: "tfl"). Fixed brand colours (see note above);
// only the pad/outline uses the theme so the marks sit on either basemap.
// ---------------------------------------------------------------------------

// London Underground roundel: a red ring with a blue bar across the middle and a
// hollow centre showing the paper/pad colour. Faithful proportions — ring
// thickness ≈ 16% of the radius, bar height ≈ 22% of the diameter.
function drawUnderground(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  const cx = BOX / 2;
  const cy = BOX / 2;
  const rOuter = BOX * 0.34;
  const ring = rOuter * 0.32; // ≈ 16% of the DIAMETER either side of the ring centreline
  // Red ring: outer disc then punch the centre back to paper.
  ctx.save();
  ctx.fillStyle = TFL_RED;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter - ring, 0, Math.PI * 2);
  ctx.fill();
  // Blue horizontal bar across the full width, height ≈ 22% of the diameter.
  const barH = rOuter * 2 * 0.22;
  ctx.fillStyle = TFL_BLUE;
  ctx.fillRect(
    cx - rOuter - BOX * 0.02,
    cy - barH / 2,
    (rOuter + BOX * 0.02) * 2,
    barH,
  );
  ctx.restore();
}

// National Rail double-arrow: two parallel horizontal strokes with arrowheads
// pointing opposite ways, offset vertically — the classic British Rail mark.
function drawRail(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  ctx.save();
  ctx.strokeStyle = RAIL_RED;
  ctx.fillStyle = RAIL_RED;
  ctx.lineWidth = STROKE * 1.1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  const left = BOX * 0.24;
  const right = BOX * 0.76;
  const topY = BOX * 0.4;
  const botY = BOX * 0.6;
  const head = BOX * 0.09;
  // Top line: shaft runs left→right, arrowhead at the right, with the classic
  // little kicked diagonal at the left end.
  ctx.beginPath();
  ctx.moveTo(left + head, topY);
  ctx.lineTo(right, topY);
  ctx.moveTo(left, topY - head); // upper-left diagonal stub
  ctx.lineTo(left + head, topY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(right, topY);
  ctx.lineTo(right - head, topY - head * 0.9);
  ctx.lineTo(right - head, topY + head * 0.9);
  ctx.closePath();
  ctx.fill();
  // Bottom line: mirror image, arrowhead at the left.
  ctx.beginPath();
  ctx.moveTo(right - head, botY);
  ctx.lineTo(left, botY);
  ctx.moveTo(right, botY + head); // lower-right diagonal stub
  ctx.lineTo(right - head, botY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left, botY);
  ctx.lineTo(left + head, botY - head * 0.9);
  ctx.lineTo(left + head, botY + head * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// London bus roundel: a solid red disc crossed by a white bar (the bus-stop flag).
function drawBus(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  const cx = BOX / 2;
  const cy = BOX / 2;
  const r = BOX * 0.34;
  ctx.save();
  ctx.fillStyle = TFL_RED;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // White bar across the disc.
  const barH = r * 2 * 0.24;
  ctx.fillStyle = WHITE;
  ctx.fillRect(cx - r, cy - barH / 2, r * 2, barH);
  ctx.restore();
}

// River-bus pier mark: a TfL-river-blue rounded square with a simple white boat +
// wave silhouette.
function drawRiver(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  drawPad(ctx, BOX, t);
  const cx = BOX / 2;
  const cy = BOX / 2;
  const s = BOX * 0.62;
  ctx.save();
  // Blue rounded-square tile.
  ctx.fillStyle = RIVER_BLUE;
  roundRectPath(ctx, cx - s / 2, cy - s / 2, s, s, BOX * 0.1);
  ctx.fill();
  // White boat hull.
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.16, cy - BOX * 0.04);
  ctx.lineTo(cx + BOX * 0.16, cy - BOX * 0.04);
  ctx.lineTo(cx + BOX * 0.1, cy + BOX * 0.06);
  ctx.lineTo(cx - BOX * 0.1, cy + BOX * 0.06);
  ctx.closePath();
  ctx.fill();
  // Little cabin on the hull.
  ctx.fillRect(cx - BOX * 0.05, cy - BOX * 0.12, BOX * 0.1, BOX * 0.08);
  // White wave beneath the boat.
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = STROKE * 0.9;
  ctx.lineCap = "round";
  ctx.beginPath();
  const waveY = cy + BOX * 0.12;
  ctx.moveTo(cx - BOX * 0.18, waveY);
  ctx.quadraticCurveTo(cx - BOX * 0.09, waveY - BOX * 0.05, cx, waveY);
  ctx.quadraticCurveTo(
    cx + BOX * 0.09,
    waveY + BOX * 0.05,
    cx + BOX * 0.18,
    waveY,
  );
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drink glyphs (ns: "drink") — glass-shaped pub pins. Key: `{kind}-{bucket}`
// (pint|wine|cocktail|spirits × price band). No circular heatmap pad — the
// marker silhouette IS the glass (soft shadow only). Unpriced = brass-grey.
// ---------------------------------------------------------------------------

export type DrinkPinKind = "pint" | "wine" | "cocktail" | "spirits";
export type VenuePinKind = DrinkPinKind | "coupe" | "skewer" | "fork";

// Soft brass-grey for unpriced pins — never pure ink/muted black (reads as a
// building blob on the basemap). Hex equivalent of a desaturated brass.
export const UNPRICED_PIN_FILL = "#9a7a72";

/**
 * The price-band fill system, in band order: <=£5.50, <=£7, >£7, no price. Each
 * priced band names the theme token it is painted from, so the bands flip with
 * the theme from one source; the unpriced band is the map-local grey above,
 * which is deliberately not a theme accent. Exported so a test can hold the
 * system to four bands in this order without restating the colours.
 */
export const VENUE_PIN_FILL_TOKEN: readonly (keyof IconTokens | null)[] = [
  "pint",
  "amber",
  "brick",
  null,
];

function priceFill(t: IconTokens, bucket: number): string {
  if (bucket === 0) return t.pint ?? t.brass;
  if (bucket === 1) return t.amber ?? t.brassBright;
  if (bucket === 2) return t.brick ?? "#d16353";
  return UNPRICED_PIN_FILL;
}

/** Soft elliptical ground shadow only — no circular pad. The pin IS the glass. */
function drawDrinkShadow(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  const cx = BOX / 2;
  const cy = BOX * 0.88;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = t.ink;
  ctx.beginPath();
  ctx.ellipse(cx, cy, BOX * 0.2, BOX * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Glass edge weights, as multiples of STROKE.
 *
 * `GLASS_RIM_STROKE` is the single-rim weight: with no casing behind it the rim
 * is the whole edge, so it has to be substantial. `GLASS_CASED_RIM_STROKE` is
 * what the rim drops to once a casing is carrying the outer edge — a hairline,
 * which matters because the rim is centred on the path and so eats the band
 * colour out of the thin-bodied glyphs (a coupe bowl, a skewer cube): a cased
 * pin ends up showing MORE of its price band than an uncased one, not less.
 * The casing survives around the finished glyph as
 * `STROKE * (CASING - CASED_RIM) / 2` beyond the rim, well inside the BOX — so a
 * casing changes what a pin looks like and never its collision footprint, which
 * is the icon box and not the ink in it.
 */
const GLASS_RIM_STROKE = 1.15;
const GLASS_CASED_RIM_STROKE = 0.7;
const GLASS_CASING_STROKE = 2;

/**
 * The same three weights in canvas units, exported so a draw-level test can
 * hold each pass to the weight it is supposed to use rather than restate the
 * numbers: `casing` is the widest, and `casedRim` is the hairline the rim drops
 * to once a casing is behind it.
 */
export const VENUE_PIN_EDGE_WIDTH = {
  rim: STROKE * GLASS_RIM_STROKE,
  casedRim: STROKE * GLASS_CASED_RIM_STROKE,
  casing: STROKE * GLASS_CASING_STROKE,
} as const;

function setDrinkGlassStyle(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale = GLASS_RIM_STROKE,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = STROKE * strokeScale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

// Silhouettes are authored ~1.4× the old cream-on-pad glyphs so they dominate
// the pin at typical map icon-size (0.6–1.05).

function drawPintSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.17, BOX * 0.18);
  ctx.lineTo(cx + BOX * 0.17, BOX * 0.18);
  ctx.lineTo(cx + BOX * 0.14, BOX * 0.82);
  ctx.lineTo(cx - BOX * 0.14, BOX * 0.82);
  ctx.closePath();
  fillStroke(ctx);
  // Handle
  ctx.beginPath();
  ctx.moveTo(cx + BOX * 0.14, BOX * 0.34);
  ctx.lineTo(cx + BOX * 0.26, BOX * 0.34);
  ctx.lineTo(cx + BOX * 0.26, BOX * 0.58);
  ctx.lineTo(cx + BOX * 0.14, BOX * 0.58);
  ctx.closePath();
  fillStroke(ctx);
}

function drawWineSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.18, BOX * 0.2);
  ctx.quadraticCurveTo(cx, BOX * 0.52, cx, BOX * 0.62);
  ctx.quadraticCurveTo(cx, BOX * 0.52, cx + BOX * 0.18, BOX * 0.2);
  ctx.closePath();
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.62);
  ctx.lineTo(cx, BOX * 0.8);
  ctx.moveTo(cx - BOX * 0.12, BOX * 0.8);
  ctx.lineTo(cx + BOX * 0.12, BOX * 0.8);
  ctx.stroke();
}

function drawCocktailSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.2, BOX * 0.2);
  ctx.lineTo(cx + BOX * 0.2, BOX * 0.2);
  ctx.lineTo(cx, BOX * 0.55);
  ctx.closePath();
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.55);
  ctx.lineTo(cx, BOX * 0.8);
  ctx.moveTo(cx - BOX * 0.12, BOX * 0.8);
  ctx.lineTo(cx + BOX * 0.12, BOX * 0.8);
  ctx.stroke();
  // Garnish cherry
  ctx.beginPath();
  ctx.arc(cx + BOX * 0.14, BOX * 0.15, BOX * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCoupeSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  // The bowl is a lens between two curves, and it has to be thick enough to
  // hold a price band: at the old 0.48/0.58 control pair it was ~1.5 units at
  // its widest, which the rim alone consumed, so a coupe printed its band as a
  // trace and read as an outline of a glass rather than a coloured one.
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.22, BOX * 0.28);
  ctx.quadraticCurveTo(cx, BOX * 0.46, cx + BOX * 0.22, BOX * 0.28);
  ctx.quadraticCurveTo(cx, BOX * 0.72, cx - BOX * 0.22, BOX * 0.28);
  ctx.closePath();
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(cx, BOX * 0.5);
  ctx.lineTo(cx, BOX * 0.78);
  ctx.moveTo(cx - BOX * 0.12, BOX * 0.78);
  ctx.lineTo(cx + BOX * 0.12, BOX * 0.78);
  ctx.stroke();
}

function drawSkewerSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  ctx.save();
  ctx.translate(cx, BOX / 2);
  ctx.rotate(-Math.PI / 5);
  ctx.beginPath();
  ctx.moveTo(0, -BOX * 0.34);
  ctx.lineTo(0, BOX * 0.36);
  ctx.stroke();
  for (const y of [-0.2, -0.04, 0.12]) {
    ctx.beginPath();
    roundRectPath(
      ctx,
      -BOX * 0.12,
      BOX * y,
      BOX * 0.24,
      BOX * 0.13,
      BOX * 0.035,
    );
    fillStroke(ctx);
  }
  ctx.restore();
}

function drawForkSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  for (const dx of [-0.125, 0, 0.125]) {
    ctx.beginPath();
    roundRectPath(
      ctx,
      cx + BOX * dx - BOX * 0.045,
      BOX * 0.16,
      BOX * 0.09,
      BOX * 0.22,
      BOX * 0.03,
    );
    fillStroke(ctx);
  }
  ctx.beginPath();
  roundRectPath(
    ctx,
    cx - BOX * 0.17,
    BOX * 0.33,
    BOX * 0.34,
    BOX * 0.17,
    BOX * 0.07,
  );
  fillStroke(ctx);
  ctx.beginPath();
  roundRectPath(
    ctx,
    cx - BOX * 0.055,
    BOX * 0.46,
    BOX * 0.11,
    BOX * 0.38,
    BOX * 0.045,
  );
  fillStroke(ctx);
}

function drawSpiritsSilhouette(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  strokeScale?: number,
): void {
  const cx = BOX / 2;
  setDrinkGlassStyle(ctx, fill, stroke, strokeScale);
  ctx.beginPath();
  ctx.moveTo(cx - BOX * 0.085, BOX * 0.18);
  ctx.lineTo(cx + BOX * 0.085, BOX * 0.18);
  ctx.lineTo(cx + BOX * 0.115, BOX * 0.3);
  ctx.lineTo(cx + BOX * 0.145, BOX * 0.8);
  ctx.lineTo(cx - BOX * 0.145, BOX * 0.8);
  ctx.lineTo(cx - BOX * 0.115, BOX * 0.3);
  ctx.closePath();
  fillStroke(ctx);
  // Cork / neck cap
  ctx.beginPath();
  roundRectPath(
    ctx,
    cx - BOX * 0.05,
    BOX * 0.1,
    BOX * 0.1,
    BOX * 0.1,
    BOX * 0.02,
  );
  fillStroke(ctx);
}

function makeVenuePinDraw(kind: VenuePinKind, bucket: number) {
  const silhouette = (
    ctx: CanvasRenderingContext2D,
    fill: string,
    stroke: string,
    strokeScale?: number,
  ) => {
    if (kind === "pint") drawPintSilhouette(ctx, fill, stroke, strokeScale);
    else if (kind === "wine") drawWineSilhouette(ctx, fill, stroke, strokeScale);
    else if (kind === "cocktail")
      drawCocktailSilhouette(ctx, fill, stroke, strokeScale);
    else if (kind === "coupe") drawCoupeSilhouette(ctx, fill, stroke, strokeScale);
    else if (kind === "skewer")
      drawSkewerSilhouette(ctx, fill, stroke, strokeScale);
    else if (kind === "fork") drawForkSilhouette(ctx, fill, stroke, strokeScale);
    else drawSpiritsSilhouette(ctx, fill, stroke, strokeScale);
  };
  return (ctx: CanvasRenderingContext2D, t: IconTokens) => {
    const fill = priceFill(t, bucket);
    drawDrinkShadow(ctx, t);
    // The rim. Light on saturated glasses, ink on the soft brass-grey unpriced
    // one — unless the theme published a rim of its own, which the dark theme
    // does because there `paper` resolves to a near-black and a "light rim"
    // silently became a black one (see venuePinEdgeTokens).
    const rim = t.pinRim ?? (bucket === 3 ? t.ink : t.paper);
    // The casing: the same glyph, once, in the opposite luminance and a hair
    // wider, so the pin keeps an edge where the basemap is too close in tone to
    // the rim to show it. Same trick the price tag beside it already uses (a
    // cream figure over an ink halo) and the route line's casing before that.
    // Omitted when the theme publishes no casing, which keeps light mode's pins
    // exactly as drawn before.
    if (t.pinCasing) {
      silhouette(ctx, t.pinCasing, t.pinCasing, GLASS_CASING_STROKE);
      silhouette(ctx, fill, rim, GLASS_CASED_RIM_STROKE);
      return;
    }
    silhouette(ctx, fill, rim);
  };
}

const VENUE_PIN_KINDS: VenuePinKind[] = [
  "pint",
  "wine",
  "cocktail",
  "spirits",
  "coupe",
  "skewer",
  "fork",
];
const DRINK_BUCKETS = [0, 1, 2, 3] as const;

export function venuePinIconKey(kind: VenuePinKind, bucket: number): string {
  const b = bucket >= 0 && bucket <= 3 ? bucket : 3;
  return `${kind}-${b}`;
}

export function drinkPinKindFromCategories(
  categories: readonly string[] | undefined,
  cocktailsAmenity: boolean,
): DrinkPinKind {
  const cats = new Set((categories ?? []).map((c) => c.toLowerCase()));
  // Recorded drink categories outrank the cocktails amenity: nearly every pub
  // pours a cocktail, so amenity-first painted classic pubs (The Black Friar,
  // owner audit) with a martini glyph. The amenity only decides when the venue
  // has no recorded categories at all.
  if (cats.has("cocktail")) return "cocktail";
  if (cats.has("wine") || cats.has("champagne") || cats.has("prosecco"))
    return "wine";
  if (
    cats.has("whisky") ||
    cats.has("gin") ||
    cats.has("vodka") ||
    cats.has("rum") ||
    cats.has("shot")
  ) {
    return "spirits";
  }
  if (
    cats.has("beer") ||
    cats.has("ale") ||
    cats.has("lager") ||
    cats.has("stout") ||
    cats.has("cider")
  ) {
    return "pint";
  }
  if (cocktailsAmenity) return "cocktail";
  return "pint";
}

// ---------------------------------------------------------------------------
// Base pub (ns: "base") — the UK-wide OSM layer. An OUTLINE, never a fill: the
// filled drink glasses mean "we know what this costs", and a base pub is
// precisely the pub nobody has priced yet. Drawn as an empty ring around a
// small dot so it reads at a glance as a socket waiting for a price rather
// than a dimmer version of a real pin.
// ---------------------------------------------------------------------------

export const UK_BASE_ICON_KEY = "pub";

// Sized against the drink silhouettes, not against nothing: a curated glass is
// ~0.64 x BOX wide, so a 0.4 x BOX ring reads as clearly the lesser mark while
// still being a mark. Anything smaller disappeared into the basemap on a 390px
// phone (owner-standard visual check), which is not "subordinate", it is absent.
const BASE_PUB_RING_RADIUS = BOX * 0.2;

// A desaturated bark neutral at reduced opacity, never brand coral: dozens of
// base rings share every street with the selection ring, so a coral base ring
// spends the accent that selection and the primary CTA own (design judgement
// 2026-08-01, findings 2.1 and 2.9). The paper backing keeps the ring legible
// over dark buildings without competing with a priced pin.
//
// LIGHT ONLY. In dark this pair was the same defect the drink pins were fixed
// for: `paper` resolves to a near-black there, so the backing disc was black
// and a 0.6-alpha bark ring over it measured a mid-grey of ~52 against a
// near-black basemap. Every UK pub outside a priced city was on the map, placed
// in the layer, and invisible - a captain browsing Cumbria reported the country
// as having no pubs at all. The dark branch below takes the SAME two-tone edge
// the bands take, through the same `pinRim` / `pinCasing` tokens
// (components/map/canvas/tokens.ts venuePinEdgeTokens), so this mark cannot
// drift from them again.
export const BASE_PUB_RING_COLOR = "#6b5f57";
export const BASE_PUB_RING_OPACITY = 0.6;

/**
 * Dark alpha for the ring. Higher than the light one because the mark is now
 * carrying its own separation rather than borrowing a light backing disc, and
 * still short of full so a base pub stays visibly second-class beside a priced
 * pin (UK_BASE_ICON_OPACITY narrows it further at the layer).
 */
export const BASE_PUB_DARK_RING_OPACITY = 0.85;

function drawBasePub(ctx: CanvasRenderingContext2D, t: IconTokens): void {
  const c = BOX / 2;
  ctx.save();
  if (t.pinRim && t.pinCasing) {
    // Dark: casing first, so the ring has an opposite-luminance edge on the
    // near-white road strokes as well as on near-black land. Same order and
    // same reason as makeVenuePinDraw.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = t.pinCasing;
    ctx.lineWidth = STROKE * 2.3;
    ctx.beginPath();
    ctx.arc(c, c, BASE_PUB_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = BASE_PUB_DARK_RING_OPACITY;
    ctx.strokeStyle = t.pinRim;
    ctx.lineWidth = STROKE * 1.15;
    ctx.beginPath();
    ctx.arc(c, c, BASE_PUB_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = t.pinRim;
    ctx.beginPath();
    ctx.arc(c, c, BOX * 0.062, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const ink = BASE_PUB_RING_COLOR;
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = t.paper;
  ctx.beginPath();
  ctx.arc(c, c, BASE_PUB_RING_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = BASE_PUB_RING_OPACITY;
  ctx.strokeStyle = ink;
  ctx.lineWidth = STROKE * 1.15;
  ctx.beginPath();
  ctx.arc(c, c, BASE_PUB_RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(c, c, BOX * 0.062, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The registry. `MAP_ICON_SPECS` is the single ordered list the caller iterates
// to register every icon via `map.addImage(iconId(ns, key), rasterize(spec, …))`.
// ---------------------------------------------------------------------------
export const MAP_ICON_SPECS: IconSpec[] = [
  // Landmark pictograms.
  { key: "clock-tower", ns: "lm", size: BOX, draw: drawClockTower },
  { key: "dome", ns: "lm", size: BOX, draw: drawDome },
  { key: "twin-towers", ns: "lm", size: BOX, draw: drawTwinTowers },
  { key: "shard", ns: "lm", size: BOX, draw: drawShard },
  { key: "wheel", ns: "lm", size: BOX, draw: drawWheel },
  { key: "gherkin", ns: "lm", size: BOX, draw: drawGherkin },
  { key: "column", ns: "lm", size: BOX, draw: drawColumn },
  { key: "civic", ns: "lm", size: BOX, draw: drawCivic },
  { key: "keep", ns: "lm", size: BOX, draw: drawKeep },
  { key: "market", ns: "lm", size: BOX, draw: drawMarket },
  { key: "canal", ns: "lm", size: BOX, draw: drawCanal },
  { key: "ship", ns: "lm", size: BOX, draw: drawShip },
  { key: "chimneys", ns: "lm", size: BOX, draw: drawChimneys },
  // TfL / National Rail wayfinding symbols.
  { key: "underground", ns: "tfl", size: BOX, draw: drawUnderground },
  { key: "rail", ns: "tfl", size: BOX, draw: drawRail },
  { key: "bus", ns: "tfl", size: BOX, draw: drawBus },
  { key: "river", ns: "tfl", size: BOX, draw: drawRiver },
  // Venue pins: one glyph raster per kind and price bucket.
  ...VENUE_PIN_KINDS.flatMap((kind) =>
    DRINK_BUCKETS.map((bucket): IconSpec => ({
      key: venuePinIconKey(kind, bucket),
      ns: "drink",
      size: BOX,
      draw: makeVenuePinDraw(kind, bucket),
    })),
  ),
  // The unpriced UK base layer's single glyph.
  { key: UK_BASE_ICON_KEY, ns: "base", size: BOX, draw: drawBasePub },
];

// Namespaced id used as the MapLibre image name: iconId("lm","clock-tower") →
// "lm:clock-tower". The colon namespace keeps landmark and TfL keys from colliding.
export function iconId(ns: IconNamespace, key: string): string {
  return `${ns}:${key}`;
}

// The landmark / TfL key lists, derived from the registry so they can never drift
// out of sync with MAP_ICON_SPECS. Frozen readonly to signal they are lookup data.
export const LANDMARK_ICON_KEYS: readonly string[] = MAP_ICON_SPECS.filter(
  (s) => s.ns === "lm",
).map((s) => s.key);

export const TFL_ICON_KEYS: readonly string[] = MAP_ICON_SPECS.filter(
  (s) => s.ns === "tfl",
).map((s) => s.key);

export const VENUE_PIN_ICON_KEYS: readonly string[] = MAP_ICON_SPECS.filter(
  (s) => s.ns === "drink",
).map((s) => s.key);

// Rasterize a spec to ImageData for `map.addImage(...)`. BROWSER-ONLY: it creates
// an offscreen canvas via `document`, so it must never be called from unit tests
// (jsdom/node canvases return a null 2d context). The caller scales the backing
// store by `pixelRatio` and then draws in CSS-pixel space, so `draw` stays
// resolution-independent.
export function rasterize(
  spec: IconSpec,
  t: IconTokens,
  pixelRatio = 2,
): ImageData {
  const c = document.createElement("canvas");
  c.width = spec.size * pixelRatio;
  c.height = spec.size * pixelRatio;
  const ctx = c.getContext("2d");
  if (!ctx)
    throw new Error("mapIcons.rasterize: 2D canvas context unavailable");
  ctx.scale(pixelRatio, pixelRatio);
  spec.draw(ctx, t);
  return ctx.getImageData(0, 0, c.width, c.height);
}
