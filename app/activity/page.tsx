import type { Metadata } from "next";

import ActivityClient from "./ActivityClient";

// Server shell for /activity so the route carries real metadata (the client
// component can't export it). This is a private, per-viewer notifications
// feed keyed to the signed-in handle, so it is noindex, follow:false — there
// is nothing here for a crawler to see.
export const metadata: Metadata = {
  title: "Activity",
  description: "Who followed you, cheered a pint, left a comment, or saved your crawl on PUBMAXX.",
  robots: { index: false, follow: false },
};

export default function ActivityPage(): React.JSX.Element {
  return <ActivityClient />;
}
