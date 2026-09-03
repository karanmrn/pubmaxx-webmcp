"use client";

// The founders' door. One anchor, one place it comes from.
//
// The invite is read from `NEXT_PUBLIC_DISCORD_INVITE_URL` through
// `lib/foundingMembers.ts` and never written into this file: a link typed into
// a component is a link nobody can rotate without a code change, and this one
// belongs to a Discord server whose invite can expire.
//
// It renders for a founding member and for nobody else. There is no signed-out
// version, no "founders only" tooltip and no greyed-out state, because a door
// somebody cannot open is an advert for a room they are not in. A reader who is
// not a founding member sees no trace of this at all.

import {
  FOUNDERS_DISCORD_CTA,
  foundersDiscordInviteUrl,
} from "@/lib/foundingMembers";

import "./foundersDiscordLink.css";

export default function FoundersDiscordLink({
  className,
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}): React.JSX.Element | null {
  const invite = foundersDiscordInviteUrl();
  if (!invite) return null;
  return (
    <a
      className={className ? `foundersDiscordLink ${className}` : "foundersDiscordLink"}
      data-pressable
      href={invite}
      target="_blank"
      rel="noreferrer noopener"
      onClick={onOpen}
    >
      {FOUNDERS_DISCORD_CTA}
    </a>
  );
}
