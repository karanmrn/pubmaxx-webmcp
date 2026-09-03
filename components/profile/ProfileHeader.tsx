"use client";

import Link from "next/link";
import { type ReactNode } from "react";

import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";
import HandleAvatar from "@/components/profile/HandleAvatar";
import ProfileSocialLinks from "@/components/profile/ProfileSocialLinks";
import { displayHandle } from "@/lib/handleDisplay";
import { profileCoverUrls } from "@/lib/profileCovers";
import {
  computeBadges,
  formatCheapestPint,
  formatStatCount,
  type Badge,
  type Profile,
  type ProfileDrop,
  type ProfileStats,
} from "@/lib/profiles";
import type { PublicSocialLink } from "@/lib/socialConnections";

type ProfileHeaderProps = {
  profile: Profile;
  stats: ProfileStats;
  viewerState?: "loading" | "resolved";
  socialLinks?: readonly PublicSocialLink[];
  /** TRI-STATE: a number counts, null is a read that could not answer, and an
   *  omitted prop falls back to the drop-derived figure. */
  crawls?: number | null;
  memories?: number;
  followers?: number;
  following?: number;
  drops?: readonly ProfileDrop[];
  actions?: ReactNode;
};

const PROFILE_STAT_LABELS = [
  "Pints logged",
  "Cheapest pint",
  "Followers",
  "Following",
  "Crawls",
  "Memories",
] as const;

/**
 * One statistic and the surface it counts. The visible text stays the bare
 * label and figure, so the grid still scans as a grid; the accessible name
 * carries where the tap goes, because "14" read aloud on its own is not a
 * destination.
 */
function ProfileStatTile({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href: string;
  hint: string;
}) {
  return (
    <div className="profileStat" role="listitem">
      {/* data-pressable is how an anchor joins the ONE shared press-scale owner
          in globals.css; a local transform here would compound with it. */}
      <Link
        className="profileStatLink"
        data-pressable
        href={href}
        aria-label={`${label}: ${value}. ${hint}.`}
      >
        <span className="profileStatLabel">{label}</span>
        <strong className="profileStatValue">{value}</strong>
      </Link>
    </div>
  );
}

function ProfileStatSkeletonTile({ label }: { label: string }) {
  return (
    <div className="profileStat" role="listitem">
      <div className="profileStatLink" aria-hidden="true">
        <span className="profileStatLabel">{label}</span>
        <strong className="profileStatValue">
          <span className="profileSkeleton profileSkeletonStat" />
        </strong>
      </div>
    </div>
  );
}

function ProfileHeaderLoading() {
  return (
    <header className="profileHeader profileHeaderLoading" aria-busy="true" aria-label="Loading profile">
      <div className="profileCover profileSkeleton" aria-hidden="true">
        <span className="profileCoverFalloff" />
      </div>

      <div className="profileHeroBody">
        <div className="profileIdentity">
          <div className="profileAvatar profileSkeleton" aria-hidden="true" />
          <div className="profileNames" aria-hidden="true">
            <span className="profileSkeleton profileSkeletonLine profileSkeletonName" />
            <span className="profileSkeleton profileSkeletonLine profileSkeletonHandle" />
          </div>
        </div>
      </div>

      <div className="profileStats" role="list" aria-hidden="true">
        {PROFILE_STAT_LABELS.map((label) => (
          <ProfileStatSkeletonTile key={label} label={label} />
        ))}
      </div>
    </header>
  );
}

/**
 * The three things a person says about themselves, in the order a stranger
 * reads them: what they drink, what they are into, where they work. Each is
 * optional and prints only when its owner filled it in - an absent line says
 * nothing rather than inviting the reader to guess.
 */
function cardFacts(profile: Profile): Array<{ id: string; label: string; value: string }> {
  return [
    { id: "drink", label: "Drinks", value: profile.favouriteDrink ?? "" },
    { id: "into", label: "Into", value: profile.interests ?? "" },
    { id: "work", label: "Works at", value: profile.workplace ?? "" },
  ].filter((fact) => fact.value.trim().length > 0);
}

export default function ProfileHeader({
  profile,
  stats,
  viewerState = "resolved",
  socialLinks,
  crawls,
  memories,
  followers,
  following,
  drops,
  actions,
}: ProfileHeaderProps) {
  const { handle, displayName, homeCity, bio, avatarUrl, foundingMemberNumber } = profile;
  if (viewerState === "loading") return <ProfileHeaderLoading />;

  // The backdrop is a rotation of up to five, and `profileCoverUrls` is the ONE
  // place the list and the single back-compat cover are reconciled.
  const covers = profileCoverUrls(profile);
  const showCover = covers.length > 0;
  const facts = cardFacts(profile);
  // Tiles link within this profile, so /u/you keeps its own sentinel route
  // rather than bouncing a signed-in reader to a handle they have not claimed.
  const profileBase = `/u/${encodeURIComponent(handle)}`;

  const crawlsPosted =
    crawls === null
      ? null
      : typeof crawls === "number"
        ? crawls
        : stats.crawlsPosted ?? 0;
  const memoriesPosted =
    typeof memories === "number" ? memories : stats.memoriesPosted ?? 0;

  const earnedBadges: Badge[] = computeBadges(drops, stats).filter((b) => b.earned);

  return (
    <header className={`profileHeader${showCover ? " profileHeaderWithCover" : ""}`}>
      {/* The banner band. It is a BAND in normal flow rather than an absolute
          strip behind the card, because its rendered aspect has to be the
          cropper's aspect: what an owner framed is what a reader sees, and a
          fixed height over a fluid width is exactly how a name gets cut in
          half. An unfilled slot keeps the brass treatment, so an initials-era
          profile still reads as a card rather than a gap. */}
      <div className="profileCover" aria-hidden="true">
        <ProfileCoverCarousel covers={covers} />
        <span className="profileCoverFalloff" />
      </div>

      {/* The hero: the face over the band's edge, the name beside it, and the
          bio as the opening line directly under both. */}
      <div className="profileHeroBody">
        <div className="profileIdentity">
          <HandleAvatar
            handle={handle}
            displayName={displayName}
            avatarUrl={avatarUrl}
            className="profileAvatar profileAvatarFallback"
            imageClassName="profileAvatar"
            size={176}
          />

          <div className="profileNames">
            <h1 className="profileDisplayName">{displayName}</h1>
            <p className="profileHandle">{displayHandle(handle)}</p>
            {homeCity ? (
              <p className="profileHomeCity">
                <span aria-hidden="true">📍 </span>
                {homeCity}
              </p>
            ) : null}
            {/* Beside the name, because that is what it is about: when this
                person arrived. It is not a badge in the earned-badge row below,
                which is a ladder of things somebody DID. */}
            <FoundingMemberMark number={foundingMemberNumber} />
          </div>

          {actions ? <div className="profileActions">{actions}</div> : null}
        </div>

        {bio ? <p className="profileBio">{bio}</p> : null}

        {facts.length ? (
          <dl className="profileCardFacts">
            {facts.map((fact) => (
              <div key={fact.id} className={`profileCardFact profileCardFact--${fact.id}`}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <ProfileSocialLinks links={socialLinks ?? []} />

        {earnedBadges.length ? (
          <ul className="profileBadges" aria-label="Badges earned">
            {earnedBadges.map((badge) => (
              <li
                key={badge.id}
                className="profileBadge"
                title={`${badge.label}: ${badge.description}`}
              >
                <span aria-hidden="true" className="profileBadgeDot" />
                <span className="profileBadgeLabel">{badge.label}</span>
                <span className="profileBadgeDesc">{badge.description}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Every tile is a way in. A statistic that counts something the page can
          show, and does not link to it, is a dead end wearing a number: the
          reader has been told they have 14 followers and given no way to see
          one. The destinations are real surfaces, so a tile never navigates to
          a promise.

          The row sits BELOW the hero and spans the whole card, because six
          figures squeezed into a narrow column is how they came to read as a
          receipt rather than as six doors. */}
      <div className="profileStats" role="list" aria-label="Profile statistics">
        <ProfileStatTile
          label="Pints logged"
          value={stats.pintsLogged}
          href={`${profileBase}#timeline`}
          hint="Open the pint timeline"
        />
        <ProfileStatTile
          label="Cheapest pint"
          value={formatCheapestPint(stats.cheapestPintGbp)}
          href={`${profileBase}#timeline`}
          hint="Open the pint timeline"
        />
        {typeof followers === "number" ? (
          <ProfileStatTile
            label="Followers"
            value={followers}
            href={`${profileBase}/people/followers`}
            hint="See who follows this handle"
          />
        ) : null}
        {typeof following === "number" ? (
          <ProfileStatTile
            label="Following"
            value={following}
            href={`${profileBase}/people/following`}
            hint="See who this handle follows"
          />
        ) : null}
        <ProfileStatTile
          label="Crawls"
          value={formatStatCount(crawlsPosted)}
          href={`${profileBase}#crawl-stories`}
          hint="Open the published crawls"
        />
        <ProfileStatTile
          label="Memories"
          value={memoriesPosted}
          href={`${profileBase}#night-memories`}
          hint="Open night memories"
        />
      </div>
    </header>
  );
}
