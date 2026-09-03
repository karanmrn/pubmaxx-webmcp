"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Check, Footprints } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { CrawlProgressEntry } from "@/lib/crawlCompletion";

type CrawlProgressSectionProps = {
  crawlProgress: CrawlProgressEntry | null;
  crawlDone: boolean;
  showCelebration: boolean;
  setShowCelebration: (show: boolean) => void;
  handleStartCrawl: () => void;
  handleMarkComplete: () => void;
  paceLabel: string;
  placeStoryBandId: string | undefined;
  dropHref: string;
  shareMapHref: string;
};

export default function CrawlProgressSection({
  crawlProgress,
  crawlDone,
  showCelebration,
  setShowCelebration,
  handleStartCrawl,
  handleMarkComplete,
  paceLabel,
  placeStoryBandId,
  dropHref,
  shareMapHref,
}: CrawlProgressSectionProps) {
  const [shareCopied, setShareCopied] = useState(false);
  const [shareCopyError, setShareCopyError] = useState("");

  async function copyShareLink() {
    const absolute =
      typeof window !== "undefined"
        ? `${window.location.origin}${shareMapHref}`
        : shareMapHref;
    setShareCopyError("");
    try {
      await navigator.clipboard.writeText(absolute);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setShareCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <div className="crawlProgressRow" data-testid="crawl-progress">
      {!crawlProgress ? (
        <button type="button" className="addStopBtn" onClick={handleStartCrawl}>
          <Footprints size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Start this crawl
        </button>
      ) : crawlDone ? (
        <p className="crawlProgressDone" role="status">
          Crawl complete: {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
        </p>
      ) : (
        <>
          <p className="crawlProgressStatus" role="status">
            {paceLabel} · {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
          </p>
          <button type="button" className="addStopBtn" onClick={handleMarkComplete}>
            <Check size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
            Mark complete
          </button>
        </>
      )}
      {showCelebration ? (
        <div
          className="crawlCelebration"
          role="status"
          data-testid="crawl-celebration"
        >
          <p className="crawlCelebrationTitle">You walked it</p>
          <p className="crawlCelebrationCopy">
            {placeStoryBandId
              ? "Place story complete. Drop a memory, share the route, or stamp your passport."
              : "Crawl complete. Drop a memory, share the route, or stamp your passport."}
          </p>
          <div className="crawlCelebrationActions">
            <Link className="crawlCelebrationLink" href={dropHref}>
              Drop a pint
            </Link>
            <button
              type="button"
              className="crawlCelebrationLink crawlCelebrationCopyBtn"
              onClick={() => void copyShareLink()}
              data-testid="crawl-share-copy"
            >
              {shareCopied ? "Link copied" : "Copy link"}
            </button>
            {shareCopyError ? <p role="status">{shareCopyError}</p> : null}
            <Link
              className="crawlCelebrationLink"
              href={shareMapHref}
              data-testid="crawl-share-open"
            >
              Open shared crawl
            </Link>
            <Link className="crawlCelebrationLink" href="/u/you">
              View passport
            </Link>
          </div>
          <button
            type="button"
            className="crawlCelebrationDismiss"
            onClick={() => setShowCelebration(false)}
          >
            Not now
          </button>
        </div>
      ) : null}
    </div>
  );
}
