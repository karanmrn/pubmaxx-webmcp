// What a message may carry BESIDE its words, and what a surface may say about
// it.
//
// PURE and browser-safe on purpose (no sharp, no storage client, no node
// builtins), so the composer, the thread, the routes and the migration all read
// one copy of the rules rather than four.
//
// THE FOUR RULES THIS FILE OWNS
//
// 1. THE SET IS CLOSED. A message carries at most ONE attachment, and it is
//    either a PHOTO or a PUB. Two kinds, named once, so a route cannot invent a
//    third and a reader cannot be handed something the thread has no shape for.
//
// 2. A PHOTO IS PRIVATE, AND ITS KEY SAYS SO. The serving key is built from the
//    conversation and the message, so the database CHECK, the upload path and
//    the serve route all say the same sentence about where a photo lives. A
//    message photo is NOT a wall photo: nothing here is public, and the bytes
//    are only ever handed to a participant through the same courtesy check the
//    thread read already makes.
//
// 3. A PUB CARD HOLDS NO PLACE, ONLY A PUB. The stored attachment is the venue
//    id and nothing else - no latitude, no longitude, no viewer point - so the
//    viewer-coordinate egress law (`lib/geo.ts`) is untouched by design. The
//    NAME, the AREA and the PRICE are resolved live on the read path, because a
//    figure frozen into a message at send time is an undated price claim that
//    nobody can correct.
//
// 4. WHAT A CARD MAY SAY ABOUT MONEY IS THE PIN'S RULE, NOT A NEW ONE. Only a
//    pub kind carries a figure, and only from the curated sourced lane - the
//    same narrower stack `formatPinPriceLabel` reads, for the same reason: a
//    bare number beside a pub name reads as tonight's pint. Everything richer
//    (the community lane, its corroboration, its date) lives one tap away on
//    the map, which is where the card sends you.

import type { CropTarget } from "@/lib/profileImagePicker";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** The closed set. One message carries at most one of these. */
export const MESSAGE_ATTACHMENT_KINDS = ["photo", "venue"] as const;
export type MessageAttachmentKind = (typeof MESSAGE_ATTACHMENT_KINDS)[number];

// ── Photo ────────────────────────────────────────────────────────────────────

/** Sentence noun for reader-facing copy, so one wording serves every message. */
export const MESSAGE_PHOTO_NOUN = "Photo";
export const MESSAGE_PHOTO_NOUN_LOWER = "photo";

/**
 * The frame a message photo is cut to. Portrait, because a phone photograph is,
 * and because a thread reads as a column: a landscape tile pushes the words
 * that follow it off the screen.
 */
export const MESSAGE_PHOTO_ASPECT_RATIO = 4 / 5;
/** Longest edge of the stored JPEG. Portrait, so height is the max edge. */
export const MESSAGE_PHOTO_MAX_EDGE = 2_048;
export const MESSAGE_PHOTO_OUTPUT_HEIGHT = MESSAGE_PHOTO_MAX_EDGE;
export const MESSAGE_PHOTO_OUTPUT_WIDTH = Math.round(
  MESSAGE_PHOTO_MAX_EDGE * MESSAGE_PHOTO_ASPECT_RATIO,
);
/** Server re-encode quality for message photos (mozjpeg). */
export const MESSAGE_PHOTO_JPEG_QUALITY = 85;

/**
 * The crop step's target. A row in the SAME table the profile slots and the pub
 * wall use, run through the one cropper - which is also what makes an iPhone's
 * HEIC uploadable, because it re-encodes whatever the browser could decode to
 * JPEG. Widening the picker never widens the server's three stored types.
 */
export const MESSAGE_PHOTO_CROP_TARGET: CropTarget = {
  id: "message-photo",
  aspectRatio: MESSAGE_PHOTO_ASPECT_RATIO,
  outputBox: {
    width: MESSAGE_PHOTO_OUTPUT_WIDTH,
    height: MESSAGE_PHOTO_OUTPUT_HEIGHT,
  },
  nounLower: MESSAGE_PHOTO_NOUN_LOWER,
  fileName: "message-photo.jpg",
};

/**
 * Storage keys. Serving and staging are SIBLINGS rather than nested, so a
 * listing of one conversation's prefix never confuses a message's folder for a
 * file. Both are pure strings, which is how the CHECK constraint in the
 * migration, the upload path and the serve route agree without any of them
 * restating a path.
 */
export const MESSAGE_PHOTO_STORAGE_PREFIX = "messages";

export function messagePhotoServingKey(
  conversationId: string,
  messageId: string,
): string {
  return `${MESSAGE_PHOTO_STORAGE_PREFIX}/${conversationId}/${messageId}.jpg`;
}

export function messagePhotoStagingKey(
  conversationId: string,
  messageId: string,
): string {
  return `${MESSAGE_PHOTO_STORAGE_PREFIX}/${conversationId}/${messageId}.staging.jpg`;
}

export function isMessagePhotoServingKey(
  conversationId: string,
  messageId: string,
  objectKey: string,
): boolean {
  return objectKey === messagePhotoServingKey(conversationId, messageId);
}

/**
 * Where a participant reads the bytes. It is under the conversation on purpose:
 * the address itself says which courtesy check owns it, and there is no public
 * lane beside it to reach for by mistake.
 */
export function messagePhotoServePath(
  conversationId: string,
  messageId: string,
): string {
  return `/api/messages/${encodeURIComponent(conversationId)}/photo/${encodeURIComponent(messageId)}`;
}

// ── Pub card ─────────────────────────────────────────────────────────────────

/**
 * What a pub card prints. Resolved on every read rather than stored, so a pub
 * that is renamed reads correctly in a message sent last month and a price that
 * moved is never quoted back from an old thread.
 *
 * `priceGbp` is null far more often than not, and that is the honest answer: a
 * pub with no figure this card is allowed to say prints its name and its area
 * and stops.
 */
export type MessageVenueCard = {
  venueId: string;
  name: string;
  area: string;
  priceGbp: number | null;
  /** Always `/map?sel=<id>`, city-aware, through the one link helper. */
  mapUrl: string;
};

export function messageVenueMapUrl(venueId: string): string {
  return venueMapUrl(venueId);
}

/**
 * Venue ids reach a storage-adjacent CHECK and a deep link, so the shape is
 * narrow on purpose: no slashes, nothing that needs escaping to be a URL
 * segment. Same alphabet the pub wall admits, for the same reason.
 */
export const MESSAGE_VENUE_ID_MAX = 64;
const VENUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isMessageVenueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MESSAGE_VENUE_ID_MAX &&
    VENUE_ID.test(value) &&
    !value.includes("..")
  );
}

// ── The attachment as it crosses the wire ────────────────────────────────────

/**
 * What a thread renders. A photo carries its own dimensions so the tile can
 * reserve its space before the bytes land (a thread that reflows under a
 * reader's thumb is a thread that loses their place).
 *
 * A venue attachment whose card could not be resolved carries `card: null`
 * rather than a guessed name: a read that failed may never read as a pub that
 * does not exist.
 */
export type MessageAttachment =
  | { kind: "photo"; url: string; width: number; height: number }
  | { kind: "venue"; venueId: string; card: MessageVenueCard | null };

/** What a writer hands the store. The photo half names the id it was keyed on. */
export type MessageAttachmentWrite =
  | {
      kind: "photo";
      messageId: string;
      objectKey: string;
      width: number;
      height: number;
    }
  | { kind: "venue"; venueId: string };

/** The stored columns, as the store reads them back. */
export type MessageAttachmentRecord = {
  kind: MessageAttachmentKind;
  objectKey: string | null;
  width: number | null;
  height: number | null;
  venueId: string | null;
};

// ── Copy ─────────────────────────────────────────────────────────────────────
// Empty, refused and unreadable states say what happened and hand the reader
// the next move. None of them leaks plumbing, and none of them slams the door.

/**
 * The composer's two attach controls. The SHORT words are what a person reads
 * on a 350px row - a two-word label wrapped onto two lines inside its own
 * button - and the long ones are the accessible names, which have room to say
 * what the control does.
 */
export const MESSAGE_ATTACH_PHOTO_LABEL = "Add a photo";
export const MESSAGE_ATTACH_VENUE_LABEL = "Share a pub";
export const MESSAGE_ATTACH_PHOTO_SHORT = "Photo";
export const MESSAGE_ATTACH_VENUE_SHORT = "Pub";
export const MESSAGE_VENUE_SEARCH_LABEL = "Search pubs";
export const MESSAGE_VENUE_SEARCH_PLACEHOLDER = "Name a pub";

export const MESSAGE_PHOTO_REFUSED_LINE =
  "That photo did not pass our checks. Choose another.";

export const MESSAGE_PHOTO_FAILED_LINE = "Could not send that photo. Try again.";

/** A photo whose bytes would not come back. Says so, and stays out of the way. */
export const MESSAGE_PHOTO_UNREADABLE_LINE = "This photo will not open just now.";

/**
 * What an inbox row says when the last message was a picture or a pub and
 * nothing else. Without it the preview is blank, which reads as a message that
 * failed to arrive rather than one with no words in it.
 */
export function messageAttachmentPreview(kind: MessageAttachmentKind): string {
  return kind === "photo" ? "Photo" : "Pub";
}

export const MESSAGE_VENUE_SEARCH_EMPTY_LINE = "No pubs by that name yet.";

export const MESSAGE_VENUE_SEARCH_FAILED_LINE =
  "Could not search pubs just now. Try again in a moment.";

export const MESSAGE_VENUE_CARD_UNRESOLVED_LINE =
  "We could not read this pub just now.";

/**
 * The accessible name of one pub card. A card read aloud is "which pub, and
 * where", so the area rides in the name rather than being left to a sighted
 * reader's eye. The price is deliberately absent from the name: it is already
 * one of the card's own lines, and a figure inside a link name reads as part of
 * the destination.
 */
export function messageVenueCardLabel(card: MessageVenueCard): string {
  return card.area ? `${card.name}, ${card.area}. Open on the map` : `${card.name}. Open on the map`;
}

/**
 * The card's price line. Two decimals, the venue sheet's own idiom, and the
 * drink is NAMED: a bare figure beside a pub name is the exact masquerade the
 * pin label rule exists to stop.
 */
export function messageVenuePriceLine(priceGbp: number | null): string | null {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) {
    return null;
  }
  return `Cheapest pint £${priceGbp.toFixed(2)}`;
}

/** The alt text of a photo somebody sent you. It names the sender, not the file. */
export function messagePhotoAltText(senderHandle: string): string {
  return senderHandle ? `Photo from @${senderHandle}` : "Photo in this conversation";
}

// ── The tile a photo occupies ────────────────────────────────────────────────

/**
 * The custom property that sizes a photo tile. ONE name, read by the reserved
 * box and by the loaded photograph, because a placeholder that is not the same
 * box as the picture is a thread that jumps when the bytes land - which is
 * exactly what it did: 87x109 reserved against a 192x240 tile at 390.
 */
export const MESSAGE_PHOTO_ASPECT_PROPERTY = "--message-photo-aspect";

/**
 * A photo's own aspect as ONE number, which is what both `aspect-ratio` and the
 * tile-width `calc()` can read.
 *
 * A dimension that is missing or nonsense falls back to the frame every message
 * photo is cut to. A box with no aspect reserves nothing, and reserving nothing
 * is the defect.
 */
export function messagePhotoAspect(width: unknown, height: unknown): number {
  const w = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : 0;
  const h = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
  return w > 0 && h > 0 ? w / h : MESSAGE_PHOTO_ASPECT_RATIO;
}
