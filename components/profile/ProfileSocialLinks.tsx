import type { PublicSocialLink } from "@/lib/socialConnections";

/**
 * The owner's linked socials on their public card. One monogram system across
 * every platform, so a service nobody drew an icon for still reads as a link
 * rather than a gap.
 *
 * rel="me" states the two accounts are the same person, which is what the row
 * claims; noopener/noreferrer and target _blank keep the outbound tap safe.
 */
export default function ProfileSocialLinks({
  links,
}: {
  links: readonly PublicSocialLink[];
}): React.JSX.Element | null {
  if (links.length === 0) return null;
  return (
    <ul className="profileSocials" aria-label="Links">
      {links.map((link) => (
        <li key={link.provider}>
          <a
            className="profileSocialLink"
            href={link.profileUrl}
            target="_blank"
            rel="me noopener noreferrer"
          >
            <span className="profileSocialMark" aria-hidden="true">
              {link.mark}
            </span>
            <span className="profileSocialName">
              {link.label}
              <span className="profileSocialHandle">{link.username}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
