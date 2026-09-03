"use client";

import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";

import {
  readSocialFriendsLaunchFromDocument,
  socialSurfaceName,
  subscribeSocialFriendsLaunchFromDocument,
} from "@/lib/socialLaunch";

/**
 * The root layout knows the flag when it renders, so it hands the answer down
 * and the served HTML already carries the right label - including in the two
 * CDN-cached prerendered documents, where a client-only read would have shown
 * every stranger the gated wording until hydration.
 */
const SocialFriendsLaunchContext = createContext<boolean | null>(null);

export function SocialFriendsLaunchProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return createElement(
    SocialFriendsLaunchContext.Provider,
    { value },
    children,
  );
}

/**
 * The body dataset read is the fallback for a tree rendered outside the
 * provider. Social is live by default, including during hydration.
 */
function serverSnapshot(): boolean {
  return true;
}

export function useSocialFriendsLaunch(): boolean {
  const provided = useContext(SocialFriendsLaunchContext);
  const fromDocument = useSyncExternalStore(
    subscribeSocialFriendsLaunchFromDocument,
    readSocialFriendsLaunchFromDocument,
    serverSnapshot,
  );
  return provided ?? fromDocument;
}

/** Desktop nav and command palette surface name (Social preview when gated). */
export function useSocialSurfaceName(): string {
  return socialSurfaceName(useSocialFriendsLaunch());
}
