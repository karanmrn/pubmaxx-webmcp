import { expect, test, type Page } from "@playwright/test";

// The bubble the first live DM on production drew wrong.
//
// An outgoing "Yo!!" rendered one character per line at 390px, because
// `max-width: 78%` sat on `.messageBubble`, whose containing block was a
// shrink-to-fit wrapper the bubble had just sized itself. Measured in Chrome
// before the fix: 42px wide, three lines, for four characters.
//
// The unit fence (`__tests__/messageBubbleAndComposer.test.ts`) pins the shipped
// CSS; only a browser can prove the arithmetic. The thread itself needs two
// signed-in accounts, so this loads the real `/messages` document - which pulls
// the real stylesheet - and measures the SAME markup the thread renders.

// The SECOND thing this file measures is the attachment tile, after a captain
// report from live mobile use that a photo in the thread rendered too large.
//
// The cap was `max-height: 15rem` - the READER'S FONT rather than the screen.
// Measured in Chrome at 390x844 before the fix: the same photograph was 240px
// tall at a 16px root, 300px at 20px and 360px (43% of the screen) at 24px, and
// once the bubble's width bound the tile the box stopped matching the picture,
// so `object-fit: cover` cut a quarter off its width with nothing to show for
// it. The reserved box was 87x109 against a 192x240 tile, so every photo
// reflowed the thread when its bytes landed.

const VIEWPORTS = [
  { name: "phone 390", width: 390, height: 844 },
  { name: "desktop 1280", width: 1280, height: 800 },
] as const;

/** The cap the stylesheet names, restated so the arithmetic can be checked. */
const PHOTO_MAX_HEIGHT_PX = 240;
const PHOTO_MAX_VIEWPORT_FRACTION = 0.4;

/** The frame a message photo is cut to, and a landscape one for the width lane. */
const PORTRAIT = { width: 1638, height: 2048 } as const;
const LANDSCAPE = { width: 1080, height: 720 } as const;

type Box = { width: number; height: number };

type MeasuredMedia = {
  photo: Box;
  pending: Box;
  landscape: Box;
  /** Each tile is held to its OWN row's bubble; a bubble is sized by what is in it. */
  bubble: Box;
  landscapeBubble: Box;
  venueBubble: Box;
  venueCard: Box;
  viewportHeight: number;
};

type Measured = {
  width: number;
  lines: number;
  rowWidth: number;
  right: number;
  rowRight: number;
};

/**
 * The thread's own markup, injected into the loaded document so it is measured
 * under the shipped stylesheet. Kept byte-identical in shape to
 * components/messages/MessageThread.tsx: row, line, bubble, meta.
 */
async function measureBubbles(page: Page): Promise<Record<string, Measured>> {
  return page.evaluate(() => {
    const host = document.querySelector(".messagesMain") ?? document.body;
    const list = document.createElement("ul");
    list.className = "threadMessages";
    list.id = "bubble-probe";
    const rows: Array<[string, string, boolean]> = [
      ["short-mine", "Yo!!", true],
      ["short-theirs", "Yo!!", false],
      [
        // Long enough to pass the 75% limit at 1280 as well as at 390, so the
        // wrap assertion below means the same thing at both widths.
        "long-mine",
        "Meeting you at the Coach and Horses at half seven, and do not be late again please, "
          + "because the last time we waited by the door for twenty five minutes in the rain "
          + "and the good table by the fire had gone to somebody else entirely by then.",
        true,
      ],
      [
        "url-mine",
        "https://pubmaxxing.com/map?sel=the-coach-and-horses-soho-w1&band=cheap&pubs=all",
        true,
      ],
    ];
    for (const [id, body, mine] of rows) {
      const row = document.createElement("li");
      row.id = id;
      row.className = mine ? "messageRow messageRowMine" : "messageRow";
      const line = document.createElement("div");
      line.className = "messageLine";
      const bubble = document.createElement("div");
      bubble.className = mine
        ? "messageBubble messageBubbleMine"
        : "messageBubble messageBubbleTheirs";
      const span = document.createElement("span");
      span.textContent = body;
      bubble.append(span);
      const meta = document.createElement("div");
      meta.className = "messageMeta";
      if (!mine) {
        const report = document.createElement("button");
        report.type = "button";
        report.className = "messageReportBtn";
        report.textContent = "Report";
        meta.append(report);
      }
      line.append(bubble, meta);
      row.append(line);
      list.append(row);
    }
    host.append(list);

    const out: Record<string, Measured> = {};
    for (const [id] of rows) {
      const row = document.getElementById(id) as HTMLElement;
      const bubble = row.querySelector(".messageBubble") as HTMLElement;
      const box = bubble.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const style = getComputedStyle(bubble);
      const lineHeight = parseFloat(style.lineHeight);
      const chrome =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      out[id] = {
        width: Math.round(box.width),
        lines: Math.round((box.height - chrome) / lineHeight),
        rowWidth: Math.round(rowBox.width),
        right: Math.round(box.right),
        rowRight: Math.round(rowBox.right),
      };
    }
    return out;
  });
}

/**
 * The thread's attachment markup, injected into the loaded document so it is
 * measured under the shipped stylesheet. Kept in the same shape as
 * components/messages/MessagePhoto.tsx and MessageVenueCard.tsx: the figure
 * carries the photo's own aspect, and the reserved box and the photograph are
 * both inside it.
 *
 * `rootFontPx` is what reproduces the defect: a reader who has raised the text
 * size on their phone. The tile must not move.
 */
async function measureMedia(page: Page, rootFontPx: number): Promise<MeasuredMedia> {
  return page.evaluate(
    async ({ rootFontPx, portrait, landscape }) => {
      document.getElementById("media-probe")?.remove();
      document.documentElement.style.fontSize = `${rootFontPx}px`;

      const draw = (w: number, h: number, fill: string): string => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = fill;
          context.fillRect(0, 0, w, h);
        }
        return canvas.toDataURL("image/png");
      };

      const host = document.querySelector(".messagesMain") ?? document.body;
      const list = document.createElement("ul");
      list.className = "threadMessages";
      list.id = "media-probe";

      const row = (id: string, fill: (bubble: HTMLElement) => void): void => {
        const item = document.createElement("li");
        item.id = id;
        item.className = "messageRow messageRowMine";
        const line = document.createElement("div");
        line.className = "messageLine";
        const bubble = document.createElement("div");
        bubble.className = "messageBubble messageBubbleMine";
        fill(bubble);
        const meta = document.createElement("div");
        meta.className = "messageMeta";
        line.append(bubble, meta);
        item.append(line);
        list.append(item);
      };

      const figure = (size: { width: number; height: number }): HTMLElement => {
        const element = document.createElement("figure");
        element.className = "messagePhotoFigure";
        element.style.setProperty("--message-photo-aspect", String(size.width / size.height));
        return element;
      };

      const loaded: Array<Promise<unknown>> = [];
      const picture = (
        size: { width: number; height: number },
        fill: string,
      ): HTMLElement => {
        const element = figure(size);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "messagePhotoButton";
        const img = document.createElement("img");
        img.className = "messagePhoto";
        img.width = size.width;
        img.height = size.height;
        img.alt = "";
        img.src = draw(size.width, size.height, fill);
        loaded.push(img.decode().catch(() => undefined));
        button.append(img);
        element.append(button);
        return element;
      };

      row("photo-mine", (bubble) => bubble.append(picture(portrait, "#c96")));
      row("photo-landscape", (bubble) => bubble.append(picture(landscape, "#69c")));
      row("photo-pending", (bubble) => {
        const element = figure(portrait);
        const box = document.createElement("p");
        box.className = "messagePhotoPending";
        box.textContent = "Loading photo";
        element.append(box);
        bubble.append(element);
      });
      row("venue-mine", (bubble) => {
        const card = document.createElement("a");
        card.className = "messageVenueCard";
        card.href = "/map?sel=probe";
        for (const [cls, text] of [
          ["messageVenueCardName", "The Coach and Horses"],
          ["messageVenueCardArea", "Soho"],
          ["messageVenueCardPrice", "Cheapest pint £5.20"],
        ]) {
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = text;
          card.append(span);
        }
        bubble.append(card);
      });

      host.append(list);
      await Promise.all(loaded);

      const box = (selector: string): { width: number; height: number } => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`missing ${selector}`);
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };

      const measured = {
        photo: box("#photo-mine .messagePhoto"),
        pending: box("#photo-pending .messagePhotoPending"),
        landscape: box("#photo-landscape .messagePhoto"),
        bubble: box("#photo-mine .messageBubble"),
        landscapeBubble: box("#photo-landscape .messageBubble"),
        venueBubble: box("#venue-mine .messageBubble"),
        venueCard: box("#venue-mine .messageVenueCard"),
        viewportHeight: window.innerHeight,
      };
      document.documentElement.style.fontSize = "";
      document.getElementById("media-probe")?.remove();
      return measured;
    },
    { rootFontPx, portrait: PORTRAIT, landscape: LANDSCAPE },
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`message bubbles at ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const response = await page.goto("/messages");
      expect(response?.status()).toBe(200);
      await expect(page.locator(".messagesMain")).toBeVisible();
    });

    test("a short message is one line, and a long one wraps at 75%", async ({ page }) => {
      const measured = await measureBubbles(page);

      // THE DEFECT: "Yo!!" over three lines in a 42px bubble.
      expect(measured["short-mine"].lines).toBe(1);
      expect(measured["short-theirs"].lines).toBe(1);
      // Natural sizing: four characters plus padding, nowhere near the limit.
      expect(measured["short-mine"].width).toBeLessThan(
        Math.round(measured["short-mine"].rowWidth * 0.4),
      );
      expect(measured["short-mine"].width).toBeGreaterThan(40);

      // A long message stops at the line's 75%, and wraps rather than growing.
      const limit = Math.round(measured["long-mine"].rowWidth * 0.75);
      expect(measured["long-mine"].width).toBeLessThanOrEqual(limit + 1);
      expect(measured["long-mine"].width).toBeGreaterThan(limit - 12);
      expect(measured["long-mine"].lines).toBeGreaterThan(1);

      // A pasted link breaks inside the bubble rather than pushing the page.
      expect(measured["url-mine"].width).toBeLessThanOrEqual(limit + 1);
    });

    test("an outgoing bubble sits on the right edge of its row", async ({ page }) => {
      const measured = await measureBubbles(page);
      expect(Math.abs(measured["short-mine"].right - measured["short-mine"].rowRight)).toBeLessThanOrEqual(1);
      expect(measured["short-theirs"].right).toBeLessThan(measured["short-theirs"].rowRight - 10);
    });

    test("the document never scrolls sideways with a link in the thread", async ({ page }) => {
      await measureBubbles(page);
      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBe(overflow.clientWidth);
    });

    test("a photo stays inside the cap, the bubble and its own aspect", async ({ page }) => {
      const measured = await measureMedia(page, 16);

      const cap = Math.min(
        PHOTO_MAX_HEIGHT_PX,
        measured.viewportHeight * PHOTO_MAX_VIEWPORT_FRACTION,
      );
      // THE DEFECT: 360px tall, 43% of the screen, on a phone at 150% text.
      expect(measured.photo.height).toBeLessThanOrEqual(cap + 1);
      expect(measured.landscape.height).toBeLessThanOrEqual(cap + 1);

      // Max-width is the bubble's OWN, so a tile never pushes its row wider. A
      // bubble is sized by what is in it, so each tile is held to its own.
      expect(measured.photo.width).toBeLessThanOrEqual(measured.bubble.width + 1);
      expect(measured.landscape.width).toBeLessThanOrEqual(
        measured.landscapeBubble.width + 1,
      );

      // The sender's framing survives, in both orientations. `cover` used to cut
      // a quarter off the width once the bubble bound the tile.
      expect(measured.photo.width / measured.photo.height).toBeCloseTo(
        PORTRAIT.width / PORTRAIT.height,
        2,
      );
      expect(measured.landscape.width / measured.landscape.height).toBeCloseTo(
        LANDSCAPE.width / LANDSCAPE.height,
        2,
      );
    });

    test("a photo is measured against the screen, never the reader's font", async ({ page }) => {
      const [normal, large, largest] = [
        await measureMedia(page, 16),
        await measureMedia(page, 20),
        await measureMedia(page, 24),
      ];
      // Measured before the fix at 390x844: 240px, 300px, 360px.
      for (const raised of [large, largest]) {
        expect(raised.photo.height).toBeCloseTo(normal.photo.height, 0);
        expect(raised.photo.width).toBeCloseTo(normal.photo.width, 0);
        expect(raised.photo.width / raised.photo.height).toBeCloseTo(
          PORTRAIT.width / PORTRAIT.height,
          2,
        );
      }
    });

    test("the reserved box is the rectangle the photograph lands in", async ({ page }) => {
      const measured = await measureMedia(page, 16);
      // THE DEFECT: 87x109 reserved for a 192x240 tile, so the thread jumped
      // under a reader's thumb every time a photo's bytes arrived.
      expect(measured.pending.width).toBeCloseTo(measured.photo.width, 0);
      expect(measured.pending.height).toBeCloseTo(measured.photo.height, 0);
    });

    test("a shared pub is a compact row rather than a preview", async ({ page }) => {
      const measured = await measureMedia(page, 16);
      // Three short lines of text. Nothing here may grow a tile of its own.
      expect(measured.venueCard.height).toBeLessThan(PHOTO_MAX_HEIGHT_PX / 2);
      expect(measured.venueCard.width).toBeLessThanOrEqual(measured.venueBubble.width + 1);
    });
  });
}

type OverlayMeasured = {
  cropCard: Box;
  viewer: Box;
  viewport: Box;
  /** Whether a hit test at each crop action's centre lands inside the card. */
  cropActionsOwnTheirTaps: boolean[];
  /** What the topmost element at each action's centre actually is. */
  cropActionOccluders: string[];
  /** The phone tab bar's own pill, and what is painted over its centre. */
  tabPill: (Box & { top: number }) | null;
  scrimOwnsTabPillCentre: boolean;
  tabPillOccluder: string;
};

/** Crop card and lightbox dialog, measured under the shipped stylesheet. */
async function measurePhoneOverlays(page: Page): Promise<OverlayMeasured> {
  return page.evaluate(async () => {
    document.getElementById("overlay-probe")?.remove();
    const host = document.querySelector(".messagesMain") ?? document.body;

    const overlay = document.createElement("div");
    overlay.id = "overlay-probe";
    overlay.className = "messageCropOverlay";
    const card = document.createElement("div");
    card.className = "messageCropCard";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    // The cropper's own last row. It is the whole point of the card, and it is
    // the part the phone tab bar used to paint over.
    const step = document.createElement("div");
    step.className = "profileCropStep";
    const frame = document.createElement("div");
    frame.className = "profileCropFrame";
    frame.style.height = "220px";
    const actions = document.createElement("div");
    actions.className = "profileCropActions";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "profileCropConfirm";
    confirm.textContent = "Use photo";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "profileCropCancel";
    cancel.textContent = "Cancel";
    actions.append(confirm, cancel);
    step.append(frame, actions);
    card.append(step);
    overlay.append(card);
    host.append(overlay);

    const dialog = document.createElement("dialog");
    dialog.id = "viewer-probe";
    dialog.className = "messagePhotoViewer";
    dialog.open = true;
    const img = document.createElement("img");
    img.className = "messagePhotoViewerImage";
    img.src =
      "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="5"/>');
    dialog.append(img);
    host.append(dialog);
    // The dialog's height is its PICTURE's height, so a rect read before the
    // image loads answers zero - which silently satisfies every upper bound
    // this probe checks. Wait for the decode, then measure.
    await img.decode().catch(() => undefined);

    const box = (selector: string): Box => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };

    const describe = (element: Element | null): string => {
      if (!element) return "nothing";
      const classes = element.className;
      return `${element.tagName.toLowerCase()}.${typeof classes === "string" ? classes : ""}`;
    };
    const hits = [confirm, cancel].map((button) => {
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return { owned: top !== null && card.contains(top), occluder: describe(top) };
    });

    // The overlay's reserved lane keeps the CARD clear of the bar, so the card
    // can never prove the stacking order. The scrim can: it is `inset: 0`, so it
    // covers the bar's own pill, and whichever of the two answers a hit test at
    // the pill's centre IS the stacking order.
    const pillElement = document.querySelector(".mobileTabList");
    const pillRect = pillElement?.getBoundingClientRect() ?? null;
    const pillTop = pillRect
      ? document.elementFromPoint(
          pillRect.left + pillRect.width / 2,
          pillRect.top + pillRect.height / 2,
        )
      : null;

    const measured = {
      cropCard: box("#overlay-probe .messageCropCard"),
      viewer: box("#viewer-probe"),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      cropActionsOwnTheirTaps: hits.map((hit) => hit.owned),
      cropActionOccluders: hits.map((hit) => hit.occluder),
      tabPill: pillRect
        ? { width: pillRect.width, height: pillRect.height, top: pillRect.top }
        : null,
      scrimOwnsTabPillCentre: pillTop !== null && overlay.contains(pillTop),
      tabPillOccluder: describe(pillTop),
    };
    document.getElementById("overlay-probe")?.remove();
    document.getElementById("viewer-probe")?.remove();
    return measured;
  });
}

test.describe("message attach preview and lightbox at phone 390", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const response = await page.goto("/messages");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".messagesMain")).toBeVisible();
  });

  test("the crop card and lightbox stay inside the viewport, not full-screen", async ({
    page,
  }) => {
    const measured = await measurePhoneOverlays(page);
    // THE DEFECT: crop and viewer took the whole phone, hiding nav and composer.
    expect(measured.cropCard.width).toBeLessThanOrEqual(measured.viewport.width);
    expect(measured.cropCard.height).toBeLessThan(measured.viewport.height * 0.85);
    expect(measured.viewer.width).toBeLessThan(measured.viewport.width - 16);
    expect(measured.viewer.height).toBeLessThan(measured.viewport.height * 0.8);
    expect(measured.viewer.width).toBeLessThanOrEqual(390 * 0.88 + 2);
  });

  test("the crop card's own Use photo and Cancel own their taps", async ({ page }) => {
    // Half of the fix: the overlay reserves the tab bar's lane, so the card's
    // last row is never laid out underneath the pill in the first place.
    const measured = await measurePhoneOverlays(page);
    expect(measured.cropActionOccluders).toEqual([
      "button.profileCropConfirm",
      "button.profileCropCancel",
    ]);
    expect(measured.cropActionsOwnTheirTaps).toEqual([true, true]);
  });

  test("the crop scrim is painted OVER the phone tab bar, not under it", async ({
    page,
  }) => {
    // THE DEFECT: the overlay sat at z-index 30 while the tab bar is fixed at
    // 1350 with an opaque pill, so the bar punched through a modal scrim and
    // owned every tap in its lane. The reserved padding alone cannot prove this
    // - it moves the card clear of the bar - so the probe asks the one point
    // where the two genuinely overlap: the pill's own centre.
    const measured = await measurePhoneOverlays(page);
    expect(measured.tabPill, "the phone tab bar must render on /messages").not.toBeNull();
    expect(measured.tabPill!.height).toBeGreaterThan(0);
    // The pill really is inside the scrim's box, so the hit test is meaningful.
    expect(measured.tabPill!.top).toBeLessThan(measured.viewport.height);
    expect(
      measured.scrimOwnsTabPillCentre,
      `the tab bar is painted over the crop scrim (topmost: ${measured.tabPillOccluder})`,
    ).toBe(true);
  });
});

/** The lightbox dialog alone, measured under whatever viewport is current. */
async function measureViewerDialog(page: Page): Promise<Box & { viewport: Box }> {
  return page.evaluate(async () => {
    document.getElementById("viewer-probe")?.remove();
    const host = document.querySelector(".messagesMain") ?? document.body;
    const dialog = document.createElement("dialog");
    dialog.id = "viewer-probe";
    dialog.className = "messagePhotoViewer";
    dialog.open = true;
    const img = document.createElement("img");
    img.className = "messagePhotoViewerImage";
    // A tall source, so the dialog's own height cap is what binds rather than
    // the picture running out.
    img.src =
      "data:image/svg+xml," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1600"/>');
    dialog.append(img);
    host.append(dialog);
    // A dialog with no loaded picture in it is zero high, and zero passes every
    // upper bound below while proving nothing. Measure the loaded thing.
    await img.decode().catch(() => undefined);
    const rect = dialog.getBoundingClientRect();
    const measured = {
      width: rect.width,
      height: rect.height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
    dialog.remove();
    return measured;
  });
}

// "View full" is a FULL-FRAME view, and the bug being fixed was a phone one, so
// the narrow caps are scoped to the 640px breakpoint and a desktop keeps the
// room it always had. That is a claim about rendered pixels at a wide viewport,
// which no read of the stylesheet can make.
test.describe("the lightbox keeps its desktop room", () => {
  test("opens near 60rem wide at 1280, not the phone's 36rem", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const response = await page.goto("/messages");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".messagesMain")).toBeVisible();

    const measured = await measureViewerDialog(page);

    // THE DEFECT: the phone bound was unconditional, so this dialog rendered
    // 576px wide (36rem) on a desktop that had been giving it 960px.
    const PHONE_CAP_PX = 36 * 16;
    expect(measured.width).toBeGreaterThan(PHONE_CAP_PX + 1);
    expect(measured.width).toBeCloseTo(60 * 16, -1);
    // And it may still not run off the screen.
    expect(measured.width).toBeLessThanOrEqual(measured.viewport.width);
    // 92dvh of room, against the phone rule's 72dvh.
    expect(measured.height).toBeGreaterThan(measured.viewport.height * 0.75);
    expect(measured.height).toBeLessThanOrEqual(measured.viewport.height * 0.93);
  });
});

// The one viewport where the 40dvh limb of the cap binds instead of the flat
// 240px: a phone held sideways. Without it the tile would be 240px of a 390px
// screen, which is most of the thread.
test.describe("message photos on a short viewport", () => {
  test("the tile falls to the viewport's share of a sideways phone", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const response = await page.goto("/messages");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".messagesMain")).toBeVisible();

    const measured = await measureMedia(page, 16);
    const cap = measured.viewportHeight * PHOTO_MAX_VIEWPORT_FRACTION;
    expect(cap).toBeLessThan(PHOTO_MAX_HEIGHT_PX);
    expect(measured.photo.height).toBeLessThanOrEqual(cap + 1);
    expect(measured.photo.height).toBeGreaterThan(cap - 2);
    expect(measured.pending.height).toBeCloseTo(measured.photo.height, 0);
  });
});
