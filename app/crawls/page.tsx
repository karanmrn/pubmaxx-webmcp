import type { Metadata } from "next";

import CrawlsPageClient from "./CrawlsPageClient";

// Server shell for /crawls so the route carries real metadata (the client
// component can't export it). Crawls is a public browse surface (like /pubs
// and /discover), so it is indexable with its own canonical + Open Graph.
const CRAWLS_TITLE = "Crawls worth walking";
const CRAWLS_DESCRIPTION =
  "Shareable London pub crawls: the stops, the prices, the vibe. Pick a route worth the walk, or build your own on the map.";

export const metadata: Metadata = {
  title: CRAWLS_TITLE,
  description: CRAWLS_DESCRIPTION,
  alternates: { canonical: "/crawls" },
  openGraph: {
    title: CRAWLS_TITLE,
    description: CRAWLS_DESCRIPTION,
    url: "/crawls",
    siteName: "PUBMAXX",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: CRAWLS_TITLE,
    description: CRAWLS_DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function CrawlsPage() {
  return <CrawlsPageClient />;
}
