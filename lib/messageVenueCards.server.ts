import "server-only";

// Resolving the pub a message points at, on the READ path.
//
// A message stores a venue id and nothing else, so this is where a card gets its
// name, its area and - sometimes - a figure. Resolving live rather than freezing
// the card at send time is the whole design: a pub that was renamed reads
// correctly in a message from last month, and a price that moved is never quoted
// back out of an old thread as though it were tonight's.
//
// WHAT A CARD MAY SAY ABOUT MONEY is the PIN's rule rather than a new one. The
// figure comes from the curated sourced lane alone and only for a pub kind -
// the same narrower stack `formatPinPriceLabel` reads, and for the same reason:
// a famous bar's cheapest anchor is a house cocktail, and printed bare beside a
// pub name it reads as a pint. A demo seed price never reaches here, because
// `lookupCanonicalVenue` returns the slim row and the seed is not on it.
//
// A read that could not answer carries `card: null`, never a guessed name: a
// venue index we could not open may not read as a pub that does not exist.

import {
  isMessageVenueId,
  messageVenueMapUrl,
  type MessageAttachment,
  type MessageVenueCard,
} from "@/lib/messageAttachments";
import type { MessageDTO } from "@/lib/messages";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

/** One pub, resolved. Null when the index does not know it or could not answer. */
export async function resolveMessageVenueCard(
  venueId: string,
): Promise<MessageVenueCard | null> {
  if (!isMessageVenueId(venueId)) return null;
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status !== "found") return null;
  const { venue, slimVenue, canonicalId } = lookup;
  // Pub kinds only, and only a real positive figure. Everything else prints its
  // name and its area and stops, which is the honest card for a pub nobody has
  // priced.
  const sayable =
    isPubVenueKind(slimVenue.kind ?? venue.kind) &&
    typeof slimVenue.cheapestPrice === "number" &&
    Number.isFinite(slimVenue.cheapestPrice) &&
    slimVenue.cheapestPrice > 0;
  return {
    venueId: canonicalId,
    name: venue.name,
    area: venue.borough ?? "",
    priceGbp: sayable ? slimVenue.cheapestPrice : null,
    mapUrl: messageVenueMapUrl(canonicalId),
  };
}

/**
 * Fill in every pub card in one thread. Distinct ids are resolved ONCE, because
 * a thread where two people swapped the same pub six times is one lookup, not
 * six; the index itself is memoised, so the cost after the first read is a map
 * get.
 */
export async function attachMessageVenueCards(
  messages: readonly MessageDTO[],
): Promise<MessageDTO[]> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.attachment?.kind === "venue") ids.add(message.attachment.venueId);
  }
  if (ids.size === 0) return [...messages];

  const cards = new Map<string, MessageVenueCard | null>();
  for (const id of ids) {
    try {
      cards.set(id, await resolveMessageVenueCard(id));
    } catch {
      // A lookup that threw is a read we could not make. `null` says so, and
      // the card says it in words rather than inventing a pub.
      cards.set(id, null);
    }
  }

  return messages.map((message) => {
    if (message.attachment?.kind !== "venue") return message;
    const attachment: MessageAttachment = {
      ...message.attachment,
      card: cards.get(message.attachment.venueId) ?? null,
    };
    return { ...message, attachment };
  });
}
