import type { Metadata } from "next";

import { identityHandleStore } from "@/lib/identityHandleStore";
import { normalizeHandle } from "@/lib/profiles";

import ProfilePageClient from "./ProfilePageClient";

// Public profile route /u/[handle]. Server shell: it owns the page metadata
// (so a shared profile shows the handle, not the generic site title) and hands
// off to the client ProfilePageClient, which owns every fetch + localStorage
// read. The OG share card is supplied by the file-convention opengraph-image.tsx
// in this folder, so generateMetadata deliberately sets NO openGraph.images —
// Next merges the file-convention image in automatically.
//
// PRIVACY: the metadata resolves only the public handle alias so retired links
// canonicalise to the current handle. It never fetches profile content, drops,
// saves, or the follow graph, so the title/description cannot leak anything the
// page does not already render publicly. "you" is the viewer's own sentinel
// route (it redirects to their real handle client-side), so it is noindex.

const YOU_SENTINEL = "you";

type PageProps = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const requestedHandle = normalizeHandle((await params).handle);

  // Missing / unusable handle, or the per-viewer "you" sentinel: keep it out of
  // search. Neither is a stable public profile URL worth indexing.
  if (!requestedHandle || requestedHandle === YOU_SENTINEL) {
    return {
      title: "Your profile",
      description: "Your PUBMAXX identity: your Pint Drops, saved venues, and crawls.",
      robots: { index: false, follow: false },
    };
  }

  // Resolve a retired public handle before publishing a canonical. Only an
  // explicit live result can publish the resolved handle. A missing answer,
  // storage failure, or tombstone keeps the requested URL out of search.
  let handle = requestedHandle;
  let canonicalVerified = false;
  let accountHasLeft = false;
  try {
    const resolution = await identityHandleStore().resolve(requestedHandle);
    accountHasLeft = resolution?.status === "gone";
    if (resolution?.status === "live") {
      handle = normalizeHandle(resolution.currentHandle) || requestedHandle;
      canonicalVerified = true;
    }
  } catch {
    canonicalVerified = false;
  }

  const title = `@${handle}`;
  if (accountHasLeft) {
    const description =
      "This account has left. The handle is still reserved, but there is no live profile here any more.";

    return {
      title,
      description,
      robots: { index: false, follow: false },
      openGraph: {
        title,
        description,
        type: "profile",
        siteName: "PUBMAXX",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  }

  const description = `@${handle}'s pint passport on PUBMAXX. Their Pint Drops, saved venues, and the crawls they've walked.`;
  const url = `/u/${handle}`;

  return {
    title,
    description,
    ...(canonicalVerified
      ? { alternates: { canonical: url } }
      : { robots: { index: false, follow: false } }),
    openGraph: {
      title,
      description,
      ...(canonicalVerified ? { url } : {}),
      type: "profile",
      siteName: "PUBMAXX",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function ProfilePage({ params }: PageProps) {
  return <ProfilePageClient params={params} />;
}
