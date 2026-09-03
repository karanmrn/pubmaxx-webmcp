import type { Metadata } from "next";

import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

import WeAreOutClient from "./WeAreOutClient";

// Server shell for /we-are-out so the route carries real metadata (the client
// component can't export it). This is a check-in composer whose posts are
// visible to your lot only, so the page itself is noindex, follow:false.
export const metadata: Metadata = {
  title: "I'm here",
  description: "Tell your lot you're here tonight. Pick an area, add a line, post.",
  robots: { index: false, follow: false },
};

export default function WeAreOutPage() {
  const socialFriendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  return <WeAreOutClient socialFriendsLaunchEnabled={socialFriendsLaunchEnabled} />;
}
