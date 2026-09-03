import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import SavedListDetail from "@/components/profile/SavedListDetail";
import { normalizeHandle } from "@/lib/profiles";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";
import { savedListPath } from "@/lib/savedListUrl";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";
import {
  cleanListType,
  savedListFollowsStore,
  savedPubsStore,
  type SavedPubDTO,
} from "@/lib/savedPubsStore";

import "../../profile.css";

export const dynamic = "force-dynamic";

type PageParams = {
  handle: string;
  listType: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type SavedListDisplayCounts = {
  followers: number | null;
  savedPubs: number;
};

function listCardHref(ownerHandle: string, listType: string, counts: SavedListDisplayCounts): string {
  const params = new URLSearchParams();
  params.set("owner", ownerHandle);
  params.set("list", listType);
  params.set("venues", String(counts.savedPubs));
  params.set("followers", counts.followers === null ? "unavailable" : String(counts.followers));
  return `/api/list-card?${params.toString()}`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle, listType: rawListType } = await params;
  const ownerHandle = normalizeHandle(handle);
  const listType = cleanListType(decodeParam(rawListType));

  if (!ownerHandle || !listType) {
    return {
      title: "Saved list",
      robots: { index: false, follow: false },
    };
  }

  const saved = await savedPubsStore().listSaved({ handle: ownerHandle });
  const venues = saved.filter((venue) => venue.listType === listType);
  const listCounts = isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])
    ? await savedListFollowsStore().counts(ownerHandle, listType)
    : null;
  const counts: SavedListDisplayCounts = {
    followers: listCounts?.followers ?? null,
    savedPubs: venues.length,
  };
  const title = `@${ownerHandle}'s ${listType}`;
  const description = `@${ownerHandle}'s ${listType} saved list on PUBMAXXING. ${formatSavedVenueCount(
    counts.savedPubs,
  )}${counts.followers === null ? "." : `, ${plural(counts.followers, "follower")}.`}`;
  const cardUrl = listCardHref(ownerHandle, listType, counts);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: savedListPath(ownerHandle, listType),
      images: [
        {
          url: cardUrl,
          width: 1200,
          height: 630,
          alt: `${title} saved list`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [cardUrl],
    },
  };
}

export default async function SavedListPage({ params }: PageProps) {
  const { handle, listType: rawListType } = await params;
  const ownerHandle = normalizeHandle(handle);
  const listType = cleanListType(decodeParam(rawListType));

  const socialFriendsLaunchEnabled = isSocialFriendsLaunchEnabled(
    process.env[SOCIAL_FRIENDS_LAUNCH_ENV],
  );
  let counts: SavedListDisplayCounts = { followers: null, savedPubs: 0 };
  let venues: SavedPubDTO[] = [];

  if (ownerHandle && listType) {
    const saved = await savedPubsStore().listSaved({ handle: ownerHandle });
    venues = saved.filter((venue) => venue.listType === listType);
    if (socialFriendsLaunchEnabled) {
      counts = {
        followers: (await savedListFollowsStore().counts(ownerHandle, listType)).followers,
        savedPubs: venues.length,
      };
    } else {
      counts = { followers: null, savedPubs: venues.length };
    }
  }

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main id="main" className="container profileMain">
        {!ownerHandle || !listType ? (
          <p className="profileEmpty">That list link is missing a handle or list name.</p>
        ) : (
          <SavedListDetail
            ownerHandle={ownerHandle}
            listType={listType}
            venues={venues}
            initialCounts={counts}
          />
        )}
      </main>
    </div>
  );
}
