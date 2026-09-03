// Share-link confirm-follow surface (Social Loop v1). A friend shares their link
// — /add/<handle> — at the table; opening it lands here and confirms adding them
// to your lot. Server component: resolve the handle from the route param, then
// hand off to the client confirm sheet.
//
// AN ADD NEEDS AN ACCOUNT (2026-08-15). The sheet no longer takes the device's
// cached handle as the adder: a signed-out visitor is offered one way in, and
// `?auto=1` is what a completed sign-up hands back so the add lands by itself.
// `lib/addLink.ts` owns that policy.
//
// A handle nobody owns is a 404 in the house voice, but ONLY when the read could
// answer: the in-memory store a keyless build runs on holds no profiles at all,
// so treating its silence as "no such person" would 404 the whole surface.
//
// D1.5: AddPageShell centres the confirm card on wide viewports and maps Escape
// to dismiss (back to feed), matching the "Not now" ghost link.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import ConfirmFollow from "@/components/social/ConfirmFollow";
import { ADD_LINK_AUTO_PARAM, parseAddLinkAuto } from "@/lib/addLink";
import { profileMayWearAvatar } from "@/lib/avatarResolve";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SocialAccessBoundary } from "@/app/social/SocialPageClient";

import AddPageShell from "./AddPageShell";
import "./add.css";

export const metadata: Metadata = {
  title: "Add to your lot · PUBMAXX",
  description: "Add a friend to your lot on PUBMAXX.",
  robots: { index: false, follow: false },
};

type RouteSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function AddHandlePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const handle = normalizeHandle((await params).handle);
  if (!handle) notFound();
  const socialEnabled = isSocialFriendsLaunchEnabled(
    process.env[SOCIAL_FRIENDS_LAUNCH_ENV],
  );
  if (!socialEnabled) {
    return (
      <main id="main" className="addShell">
        <SiteNav active="feed" />
        <AddPageShell>
          <SocialAccessBoundary state="preview" friendsLaunchEnabled={false} />
        </AddPageShell>
      </main>
    );
  }
  // A store failure is not an answer. Only a durable store that came back with
  // nothing proves the handle belongs to nobody.
  const profile = await profileStore()
    .getByHandle(handle)
    .catch(() => undefined);
  if (
    isProfileTombstoned(profile) ||
    (profile === null && isSupabaseConfigured())
  ) {
    notFound();
  }
  const targetAvatarUrl =
    profile && profileMayWearAvatar(profile) ? publicOwnedImageUrl(profile, "avatar") ?? undefined : undefined;
  const auto = parseAddLinkAuto(first((await searchParams)[ADD_LINK_AUTO_PARAM]));
  return (
    <main id="main" className="addShell">
      <SiteNav active="feed" />
      <AddPageShell>
        <ConfirmFollow
          targetHandle={handle}
          targetAvatarUrl={targetAvatarUrl}
          targetName={profile?.displayName}
          auto={auto}
        />
      </AddPageShell>
    </main>
  );
}
