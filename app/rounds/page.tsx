import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/EmptyState";
import SiteNav from "@/components/nav/SiteNav";

import "./[code]/round.css";

// Branded entry for /rounds (no code) — previously a bare Next 404 dead-end. A
// round is always JOINED from a share link/code (/rounds/<code>), so this
// surface explains that honestly and points to where you start one, rather than
// looking broken. Same honest empty-state pattern as the crawls/plan surfaces.

export const metadata: Metadata = {
  title: "Rounds · PUBMAXXING",
  description: "Rounds are joined from a share link. Start one from the map.",
  robots: { index: false, follow: false },
};

export default function RoundsIndex(): React.JSX.Element {
  return (
    <main id="main" className="roundShell">
      <SiteNav />

      <EmptyState
        eyebrow="Rounds"
        title="Join with a link"
        body="A round opens from the link whoever started it sent you (pubmaxxing.com/rounds/…). Got a code? Add it to that link. Starting the night yourself? Kick a round off from the map."
        action={
          <Link href="/map" className="roundPrimaryBtn">
            Start a round on the map
          </Link>
        }
      />
    </main>
  );
}
