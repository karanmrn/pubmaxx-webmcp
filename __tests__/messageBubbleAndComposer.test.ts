// The thread a person actually types into, fenced at the two places it broke.
//
// 1. THE COLLAPSED BUBBLE. The first live DM on production rendered an outgoing
//    "Yo!!" as one character per line at 390px. The cause was one declaration:
//    `max-width: 78%` sat on `.messageBubble`, whose containing block was a
//    shrink-to-fit wrapper the bubble had just sized itself. So the percentage
//    resolved against the bubble's OWN natural width, every bubble was clamped
//    to 78% of itself, and `overflow-wrap: anywhere` broke mid-word to obey.
//    Measured in Chrome at 390: the bubble was 42px wide over three lines.
//
//    The limit belongs on `.messageLine`, which has the row's real width to
//    measure against, and `width: fit-content` is what keeps a short message
//    natural: `fit-content` floors on the AVAILABLE width, where a flex item's
//    automatic minimum floors on min-content - one character, under `anywhere`.
//    There is no layout engine in this suite, so the arithmetic is fenced on the
//    SHIPPED CSS and the markup that carries it; `e2e/messages-mobile.spec.ts`
//    measures the rendered boxes at 390px and 1280px.
//
// 2. THE COMPOSER. A message is somebody talking, so the field helps them the
//    way every other field on their phone does: sentence case, autocorrect on,
//    spelling checked. `autocorrect="off"` anywhere on this surface is the
//    defect, and the sweep below is tree-wide over components/messages.
//
// 3. THE OVERSIZED PHOTO. Captain report from live mobile use. The tile was
//    capped at `max-height: 15rem`, which is the READER'S FONT rather than the
//    screen: measured in Chrome at 390x844, the same photograph rendered 240px
//    tall at a 16px root, 300px at 20px and 360px - 43% of the screen - at
//    24px. Past the point where the bubble's width bound the tile, the box's
//    aspect stopped matching the picture's and `object-fit: cover` CUT the
//    sender's framing (222x360 against a 4:5 photograph). And the reserved box
//    was 87x109 against a 192x240 tile, so every photo reflowed the thread when
//    its bytes landed.
//
//    The cap is now the viewport's and the bubble's, the aspect rides on the
//    tile so nothing is ever cropped, and the figure takes a definite width so
//    the placeholder and the photograph are one rectangle. Measured after, at
//    390x844: 192x240 at 16px, 20px AND 24px root, aspect 0.8 exactly, zero
//    jump; on a phone held sideways (844x390) the 40dvh limb binds at 124.8x156.
//    `e2e/message-bubble-geometry.spec.ts` measures the rendered boxes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MessageAttachmentPicker from "@/components/messages/MessageAttachmentPicker";

import {
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_PHOTO_ASPECT_PROPERTY,
  MESSAGE_PHOTO_ASPECT_RATIO,
  messagePhotoAspect,
} from "@/lib/messageAttachments";
import { MAX_MESSAGE_BODY } from "@/lib/messages";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const CSS = read("app/messages/messages.css");
const THREAD = read("components/messages/MessageThread.tsx");
const PICKER = read("components/messages/MessageAttachmentPicker.tsx");
const PHOTO = read("components/messages/MessagePhoto.tsx");

/** One rule body out of the shipped stylesheet, by selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `${selector} is missing from app/messages/messages.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

/**
 * The same, but read out of a `@media (max-width: 640px)` block - the shared
 * mobile breakpoint. Brace-matched, so a selector that only exists OUTSIDE the
 * block cannot satisfy a phone assertion.
 */
function phoneRule(selector: string): string {
  const marker = "@media (max-width: 640px)";
  for (let from = CSS.indexOf(marker); from > -1; from = CSS.indexOf(marker, from + 1)) {
    let depth = 0;
    let end = from;
    for (let at = CSS.indexOf("{", from); at < CSS.length && at > -1; at += 1) {
      if (CSS[at] === "{") depth += 1;
      if (CSS[at] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = at;
          break;
        }
      }
    }
    const block = CSS.slice(from, end);
    const at = block.indexOf(`${selector} {`);
    if (at > -1) return block.slice(at, block.indexOf("}", at));
  }
  throw new Error(`${selector} is missing from every 640px block in app/messages/messages.css`);
}

describe("a bubble's width is the row's business, never the bubble's own", () => {
  it("puts the width limit on the line, with the row to measure against", () => {
    const line = rule(".messageLine");
    expect(line).toMatch(/max-width:\s*75%/);
    // Without this the line is a flex item whose automatic minimum size is
    // min-content, which `overflow-wrap: anywhere` makes one character wide.
    expect(line).toMatch(/width:\s*fit-content/);
    expect(line).toMatch(/min-width:\s*0/);
  });

  it("leaves the bubble no percentage width of its own", () => {
    const bubble = rule(".messageBubble");
    // THE DEFECT, exactly: a FRACTIONAL percentage max-width, resolved against
    // a parent the bubble had just sized. Filling its own line is the only
    // percentage a bubble may name.
    const percentages = [...bubble.matchAll(/max-width:\s*(\d+(?:\.\d+)?)%/g)].map((hit) =>
      Number(hit[1]),
    );
    expect(percentages).toEqual([100]);
  });

  it("still breaks a pasted link rather than pushing the page sideways", () => {
    expect(rule(".messageBubble")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("wraps every bubble in the line that carries the limit", () => {
    expect(THREAD).toContain('<div className="messageLine">');
    // One line per row, and the bubble is inside it.
    const line = THREAD.indexOf('<div className="messageLine">');
    const bubble = THREAD.indexOf("messageBubble messageBubbleMine");
    expect(bubble).toBeGreaterThan(line);
  });

  it("keeps an own message's meta under the bubble it belongs to", () => {
    // An outgoing message's meta is usually empty, which is why the collapse
    // showed up on that side first: nothing else held the line open.
    expect(rule(".messageRowMine .messageMeta")).toMatch(/justify-content:\s*flex-end/);
  });
});

describe("the composer is a field somebody can talk into", () => {
  it("leaves the phone keyboard's help switched ON", () => {
    expect(THREAD).toContain('autoCapitalize="sentences"');
    expect(THREAD).toContain('autoCorrect="on"');
    expect(THREAD).toContain("spellCheck");
  });

  it("never turns autocorrect, autocapitalise or spellcheck off anywhere here", () => {
    for (const file of [
      "components/messages/MessageThread.tsx",
      "components/messages/MessageVenuePicker.tsx",
      "components/messages/MessagePhoto.tsx",
      "components/messages/MessageVenueCard.tsx",
      "components/messages/ProfileMessageButton.tsx",
      "app/messages/MessagesInboxClient.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} turns autocorrect off`).not.toMatch(/autoCorrect=["{]?["']?off/i);
      expect(source, `${file} turns autocapitalise off`).not.toMatch(
        /autoCapitalize=["{]?["']?(off|none)/i,
      );
      expect(source, `${file} turns spellcheck off`).not.toMatch(/spellCheck=\{false\}/);
    }
  });

  it("grows with what is typed and stops where the CSS says", () => {
    expect(THREAD).toContain("rows={1}");
    // Measured off scrollHeight, because a row count cannot know how a line
    // wrapped.
    expect(THREAD).toContain("field.style.height = `${field.scrollHeight}px`");
    const input = rule(".composerInput");
    expect(input).toMatch(/resize:\s*none/);
    expect(input).toMatch(/max-height:\s*9rem/);
    expect(input).toMatch(/min-height:\s*44px/);
  });

  it("sends on Enter only where there is a modifier to spare", () => {
    expect(THREAD).toContain('window.matchMedia("(pointer: fine)")');
    // Shift+Enter is a new line on every device.
    expect(THREAD).toMatch(/if \(e\.key !== "Enter" \|\| e\.shiftKey\) return;/);
    expect(THREAD).toContain("if (!enterSends) return;");
    expect(THREAD).toContain('enterKeyHint={enterSends ? "send" : "enter"}');
  });

  it("refuses to send nothing, and counts what a person may actually send", () => {
    expect(THREAD).toContain("disabled={!canSend}");
    // A photo is a message: something to send is text, an attachment, or both.
    expect(THREAD).toContain(
      "const hasSomething = draft.trim().length > 0 || pending !== null;",
    );
    expect(THREAD).toContain("const canSend = hasSomething && !over && !sending;");
  });

  it("keeps the counter honest about the cap it is counting to", () => {
    // The field admits a little more than the cap so the over-count can be SEEN
    // and refused, rather than the browser silently swallowing the keystroke
    // that went past it.
    expect(THREAD).toContain("{draft.length}/{MAX_MESSAGE_BODY}");
    expect(THREAD).toContain("maxLength={MAX_MESSAGE_BODY + 100}");
    expect(THREAD).toContain("const over = draft.length > MAX_MESSAGE_BODY;");
    expect(MAX_MESSAGE_BODY).toBe(1000);
  });

  it("gives every control a 44px box", () => {
    for (const selector of [
      ".composerSend",
      ".composerAttach",
      ".composerPendingRemove",
      ".composerVenueSearch",
      ".composerVenueResult",
      ".messagePhotoViewerClose",
    ]) {
      expect(rule(selector), selector).toMatch(/min-height:\s*44px/);
    }
    for (const selector of [".composerSend", ".composerAttach", ".messagePhotoViewerClose"]) {
      expect(rule(selector), selector).toMatch(/min-width:\s*44px/);
    }
  });
});

describe("mobile message attachment picker", () => {
  it("renders labelled library, camera, and file targets with honest inputs", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageAttachmentPicker, {
        open: true,
        disabled: false,
        onOpenChange: () => {},
        onFileChange: () => {},
        onKindSelected: () => {},
      }),
    );

    expect(markup).toContain('class="mobileSheetPortal messageAttachSheetPortal"');
    expect(markup).toContain('class="mobileSharedSheet');
    expect(markup).toContain(">Photos</span>");
    expect(markup).toContain(">Camera</span>");
    expect(markup).toContain(">Document</span>");
    expect(markup).toMatch(/id="message-photo-file"[^>]*type="file"[^>]*>/);
    expect(markup).toMatch(/id="message-camera-file"[^>]*type="file"[^>]*capture="environment"[^>]*>/);
    expect(markup).toMatch(/id="message-document-file"[^>]*type="file"[^>]*>/);
    expect(markup).not.toMatch(/id="message-photo-file"[^>]*capture=/);
    expect(markup).not.toMatch(/id="message-document-file"[^>]*capture=/);
  });

  it("keeps picker controls mobile-only and touch-safe", () => {
    const mobileGate = CSS.slice(CSS.indexOf("@media (max-width: 640px)"));
    expect(THREAD).toContain("MOBILE_MEDIA_QUERY");
    expect(mobileGate).toMatch(/\.composerMobileAttach\s*\{[\s\S]*display:\s*inline-flex/);
    expect(mobileGate).toMatch(/\.composerPhotoDesktop\s*\{[\s\S]*display:\s*none/);
    expect(CSS).toMatch(/\.messageAttachTarget\s*\{[\s\S]*min-width:\s*56px/);
    expect(CSS).toMatch(/\.messageAttachTarget\s*\{[\s\S]*min-height:\s*56px/);
    expect(CSS).toMatch(/\.messageAttachTarget\s*\{[\s\S]*touch-action:\s*manipulation/);
    expect(CSS).toMatch(/\.messageAttachTarget\s*\{[\s\S]*user-select:\s*none/);
    expect(THREAD).toContain('trackEvent("message_attach_selected", { kind });');
    expect(PICKER).toContain("onClick={close}");
    expect(PICKER).toContain("onPointerDown={onDragStart}");
    expect(PICKER).toContain("onPointerMove={onDragMove}");
    expect(PICKER).toContain("onPointerUp={onDragEnd}");
    expect(PICKER).toContain("SWIPE_DISMISS_PX");
  });
});

describe("a photo tile is measured against the screen, never the reader's font", () => {
  it("caps the tile in viewport units and absolute pixels, with no rem anywhere", () => {
    const figure = rule(".messagePhotoFigure");
    // THE DEFECT, exactly: a cap denominated in the root font size, which grew
    // the same photograph from 240px to 360px as a reader raised their text.
    expect(figure).toMatch(/--message-photo-max-height:\s*min\(40dvh,\s*240px\)/);
    for (const selector of [".messagePhotoFigure", ".messagePhoto", ".messagePhotoPending"]) {
      const body = rule(selector);
      const heightCaps = [...body.matchAll(/max-height:\s*([^;]+);/g)].map((hit) => hit[1]);
      for (const cap of heightCaps) {
        expect(cap, `${selector} caps a photo in rem`).not.toMatch(/rem/);
      }
    }
    // `dvh` rather than `vh`: on a phone the URL bar makes them different, and
    // this cap only ever binds on the short viewport where that shows.
    expect(figure).not.toMatch(/\d+vh/);
  });

  it("never crops the sender's framing", () => {
    // `cover` fills the box by CUTTING the picture, and the box stopped matching
    // the picture the moment the bubble's width bound the tile. A reader cannot
    // tell that anything was removed, which is what makes it worse than a tile
    // of the wrong size.
    expect(rule(".messagePhoto")).toMatch(/object-fit:\s*contain/);
    expect(rule(".messagePhoto")).not.toMatch(/object-fit:\s*cover/);
    expect(rule(".messagePhoto")).toMatch(
      new RegExp(`aspect-ratio:\\s*var\\(${MESSAGE_PHOTO_ASPECT_PROPERTY}`),
    );
  });

  it("reserves the same rectangle the photograph will occupy", () => {
    // The placeholder used to be a bare `<p>` with an `aspect-ratio` and no
    // width to measure it against, inside a `fit-content` line: 87x109 reserved
    // for a 192x240 tile.
    const figure = rule(".messagePhotoFigure");
    expect(figure).toMatch(
      new RegExp(
        `width:\\s*calc\\(var\\(--message-photo-max-height\\)\\s*\\*\\s*var\\(${MESSAGE_PHOTO_ASPECT_PROPERTY}`,
      ),
    );
    expect(figure).toMatch(/max-width:\s*100%/);
    const pending = rule(".messagePhotoPending");
    expect(pending).toMatch(/width:\s*100%/);
    expect(pending).toMatch(
      new RegExp(`aspect-ratio:\\s*var\\(${MESSAGE_PHOTO_ASPECT_PROPERTY}`),
    );
    // Both states render the figure, or there is nothing for the width to sit on.
    expect(PHOTO).toContain(`[MESSAGE_PHOTO_ASPECT_PROPERTY]: messagePhotoAspect(width, height)`);
    expect(PHOTO.match(/className="messagePhotoFigure" style=\{tile\}/g)).toHaveLength(2);
  });

  it("falls back to the frame a message photo is cut to when a dimension is missing", () => {
    expect(messagePhotoAspect(1080, 1350)).toBeCloseTo(0.8, 10);
    expect(messagePhotoAspect(1080, 720)).toBeCloseTo(1.5, 10);
    for (const bad of [
      [0, 1350],
      [1080, 0],
      [-4, 5],
      [Number.NaN, 1350],
      [null, undefined],
      ["1080", "1350"],
    ] as const) {
      expect(messagePhotoAspect(bad[0], bad[1])).toBe(MESSAGE_PHOTO_ASPECT_RATIO);
    }
  });

  it("has no document attachment to render, so nothing may grow a preview for one", () => {
    // v1 shipped two kinds and only two. A compact row is what a non-photo
    // attachment gets, and the pub card is already one.
    expect([...MESSAGE_ATTACHMENT_KINDS]).toEqual(["photo", "venue"]);
    const card = rule(".messageVenueCard");
    expect(card).toMatch(/padding:\s*0\.5rem 0\.6rem/);
    expect(card).not.toMatch(/(height|aspect-ratio):/);
  });
});

describe("a phone crop and lightbox stay bounded, not full-screen", () => {
  it("anchors the crop step in a bottom card over a dimmed thread", () => {
    const overlay = rule(".messageCropOverlay");
    expect(overlay).toMatch(/align-items:\s*flex-end/);
    expect(overlay).not.toMatch(/align-items:\s*stretch/);
    const card = rule(".messageCropCard");
    expect(card).toMatch(/width:\s*min\(100%,\s*24rem\)/);
    expect(card).toMatch(/max-height:\s*min\(70dvh/);
  });

  it("keeps the lightbox dialog inside the viewport on phone", () => {
    // The narrow caps belong to the phone alone: a desktop "view full" keeps
    // the 60rem / 92dvh room it has always had, so the bound is read out of the
    // 640px block rather than the base rule.
    const viewer = phoneRule(".messagePhotoViewer");
    expect(viewer).toMatch(/width:\s*min\(88vw,\s*36rem\)/);
    expect(viewer).toMatch(/max-height:\s*min\(\s*72dvh/);
    expect(viewer).not.toMatch(/width:\s*100vw/);
    expect(viewer).not.toMatch(/height:\s*100vh/);
    expect(rule(".messagePhotoViewerImage")).toMatch(/object-fit:\s*contain/);
  });
});
// The desktop half of that bound is a RENDERED claim about a 1280px dialog, so
// it is measured in e2e/message-bubble-geometry.spec.ts rather than read off the
// stylesheet here: a clamp or a custom property would keep the pixels and fail a
// regex, and a rule the cascade has killed would pass one.
