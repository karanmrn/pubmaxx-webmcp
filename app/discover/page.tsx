import type { Metadata } from "next";

import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";
import { loadHeritageCrawls } from "@/lib/heritageCrawls";

import DiscoverPageClient from "./DiscoverPageClient";

// Compatibility shell only. next.config redirects this route before render.
export const metadata: Metadata = {
  alternates: { canonical: "/social?tab=discover" },
};

export default async function DiscoverPage() {
  const rivalry = buildCityRivalrySnapshot();
  // Deterministic, provenance-honest heritage routes built server-side from the
  // cited historic-pub data, passed down for the "Historic London" section.
  const heritageCrawls = await loadHeritageCrawls();
  return <DiscoverPageClient rivalry={rivalry} heritageCrawls={heritageCrawls} />;
}
