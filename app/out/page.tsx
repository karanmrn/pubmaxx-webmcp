import type { Metadata } from "next";

import { parseOutDayWindow } from "@/lib/outListings";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";

import OutClient from "./OutClient";

import "./out.css";

const PAGE_TITLE = "Out";
const PAGE_DESCRIPTION =
  "What's on in London. Live music, quiz nights, and events from sourced listings. Open a plan when you have one.";

// /out is NOT a crawlable family yet. It lists the same baseline What's-On rows
// /tonight already publishes for the same city, so two indexable pages would
// compete for one canonical - the shape /area/{slug} was held back for (captain
// decision 2026-08-15). It carries no canonical and is absent from the sitemap
// until L2 and L4 give it content of its own. The Open Graph tags stay, because
// a shared link still deserves a card and `og:` is not an indexing instruction.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/out",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export const runtime = "nodejs";

export default async function OutPage({
  searchParams,
}: {
  searchParams?: Promise<{ day?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const day = parseOutDayWindow(params.day);
  return <OutClient day={day} />;
}
