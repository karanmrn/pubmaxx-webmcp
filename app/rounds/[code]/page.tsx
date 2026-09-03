import type { Metadata } from "next";

import RoundPageClient from "./RoundPageClient";

// Server shell for /rounds/[code] so the route carries real metadata (the
// client component can't export it). A round code is an ephemeral, shared
// session token, not a durable public page (matching /rounds itself), so it is
// noindex, follow:false.
export const metadata: Metadata = {
  title: "Round",
  description: "Join the round and see where the crew is heading next on PUBMAXX.",
  robots: { index: false, follow: false },
};

export default function RoundPage({
  params,
}: {
  params: Promise<{ code: string }>;
}): React.JSX.Element {
  return <RoundPageClient params={params} />;
}
