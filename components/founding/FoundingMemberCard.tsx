"use client";

// The founding member's own card on You: their number, and the door to the
// room. Mounted in `components/profile/PubmaxxAccountHub.tsx`.
//
// It renders for a founding member and for NOBODY else. A person who is not one
// gets no card, no greyed door, and no count of what they missed. That asymmetry
// is the whole design: the status buys belonging, so the only person it ever
// speaks to is somebody who already belongs.
//
// While the live session is still answering it renders nothing either, because
// a card that appeared for everybody and then vanished for the ninety-nine
// percent would be an advert with a retraction.

import FoundersDiscordLink from "@/components/founding/FoundersDiscordLink";
import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import { useFoundingMembership } from "@/components/founding/useFoundingMembership";

export default function FoundingMemberCard(): React.JSX.Element | null {
  const membership = useFoundingMembership();
  if (membership.state !== "member") return null;
  return (
    <div className="accountHubFounding">
      {/* The mark IS the heading. A separate "Founding member" title above it
          would print the same three words twice. */}
      <h3>
        <FoundingMemberMark number={membership.number} />
      </h3>
      <FoundersDiscordLink />
    </div>
  );
}
