"use client";

// The pub somebody shared with you, as a card that opens the map on it.
//
// It prints what the READ path resolved (`lib/messageVenueCards.server.ts`) and
// nothing else. There is no figure of its own here and no fallback name: a card
// whose lookup could not answer says so in words, because a pub we could not
// read may never render as a pub that does not exist.

import Link from "next/link";

import {
  MESSAGE_VENUE_CARD_UNRESOLVED_LINE,
  messageVenueCardLabel,
  messageVenuePriceLine,
  type MessageVenueCard as VenueCard,
} from "@/lib/messageAttachments";

export default function MessageVenueCard({
  card,
}: {
  card: VenueCard | null;
}): React.JSX.Element {
  if (!card) {
    return <p className="messageVenueCardUnresolved">{MESSAGE_VENUE_CARD_UNRESOLVED_LINE}</p>;
  }
  const price = messageVenuePriceLine(card.priceGbp);
  return (
    <Link href={card.mapUrl} className="messageVenueCard" aria-label={messageVenueCardLabel(card)}>
      <span className="messageVenueCardName">{card.name}</span>
      {card.area ? <span className="messageVenueCardArea">{card.area}</span> : null}
      {price ? <span className="messageVenueCardPrice">{price}</span> : null}
    </Link>
  );
}
