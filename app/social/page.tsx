import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";
import { loadHeritageCrawls } from "@/lib/heritageCrawls";
import { parseSocialShellSearch } from "@/lib/socialShell";
import { socialDocumentRobots, socialSurfaceName } from "@/lib/socialLaunch";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

import SocialPageClient from "./SocialPageClient";

const SOCIAL_DESCRIPTION =
  "Chronological pub-night posts and public pub discovery.";

type SearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

export async function generateMetadata(): Promise<Metadata> {
  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  const surface = socialSurfaceName(friendsLaunchEnabled);
  return {
    title: surface,
    description: SOCIAL_DESCRIPTION,
    alternates: { canonical: "/social" },
    robots: socialDocumentRobots(friendsLaunchEnabled),
    openGraph: {
      title: appPageTitle(surface),
      description: SOCIAL_DESCRIPTION,
      url: "/social",
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = parseSocialShellSearch(toUrlSearchParams(await searchParams));
  if (!state.valid) redirect("/social");

  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");

  const [rivalry, heritageCrawls] =
    friendsLaunchEnabled && state.tab === "discover"
      ? await Promise.all([buildCityRivalrySnapshot(), loadHeritageCrawls()])
      : [[], []];

  return (
    <SocialPageClient
      initialState={state}
      rivalry={rivalry}
      heritageCrawls={heritageCrawls}
      friendsLaunchEnabled={friendsLaunchEnabled}
    />
  );
}
