import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/EmptyState";

import "./story.css";

// Branded not-found for /crawls/[slug] — rendered when the page calls
// notFound() on an unknown OR draft slug (a draft is private, so it must look
// identical to missing). Same honest empty-state pattern as the Rounds page:
// a short line, a grounded explainer, one route back — never a bare 404.

export const metadata: Metadata = {
  title: "Crawl Story",
  robots: { index: false, follow: false },
};

export default function CrawlStoryNotFound(): React.JSX.Element {
  return (
    <main id="main" className="storyShell">
      <nav className="storyNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/social?tab=discover">Explore</Link>
      </nav>

      <EmptyState
        eyebrow="Crawl Story"
        title="No crawl here"
        body="This crawl doesn't exist, or it hasn't been published yet. Check the link with whoever sent it, or browse the crawls people have already put on record."
        action={
          <Link href="/crawls" className="storyPrimaryBtn">
            Back to crawls
          </Link>
        }
      />
    </main>
  );
}
