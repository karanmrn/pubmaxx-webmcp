"use client";

import { useEffect, useState } from "react";

import type { Venue } from "@/lib/venues";
import {
  acknowledgeCrawlCompletion,
  isComplete,
  markCrawlComplete,
  readCrawl,
  startCrawl,
  type CrawlProgressEntry,
} from "@/lib/crawlCompletion";

export type CrawlProgressState = {
  crawlProgress: CrawlProgressEntry | null;
  showCelebration: boolean;
  setShowCelebration: (show: boolean) => void;
  crawlDone: boolean;
  handleStartCrawl: () => void;
  handleMarkComplete: () => void;
};

// Loop 2 crawl-completion stickiness — localStorage only. Owns crawlProgress +
// the one-shot celebration flag (Wave G2), claimed via acknowledgeCrawlCompletion.
export function useCrawlProgress(
  progressKey: string,
  route: Venue[],
  placeStoryBandId: string | undefined,
): CrawlProgressState {
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgressEntry | null>(null);
  // Wave G2: one-shot celebration after 100% — claimed via acknowledgeCrawlCompletion.
  const [showCelebration, setShowCelebration] = useState(false);

  function applyCompletionAck(entry: CrawlProgressEntry | null) {
    setCrawlProgress(entry);
    if (!progressKey || !isComplete(entry)) {
      setShowCelebration(false);
      return;
    }
    const ack = acknowledgeCrawlCompletion(progressKey, { placeStoryBandId });
    setShowCelebration(ack.celebrate);
  }

  useEffect(() => {
    let active = true;
    async function hydrate() {
      const entry = progressKey && route.length >= 2 ? readCrawl(progressKey) : null;
      if (!active) return;
      setCrawlProgress(entry);
      // Remount with an already-complete crawl: credit quest if needed, but only
      // celebrate when the one-shot flag is still unset.
      if (progressKey && isComplete(entry)) {
        const ack = acknowledgeCrawlCompletion(progressKey, { placeStoryBandId });
        if (active) setShowCelebration(ack.celebrate);
      } else if (active) {
        setShowCelebration(false);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [progressKey, route.length, placeStoryBandId]);

  function handleStartCrawl() {
    if (!progressKey || route.length < 2) return;
    const entry = startCrawl(
      progressKey,
      route.map((v) => v.id),
    );
    setCrawlProgress(entry);
    setShowCelebration(false);
  }

  function handleMarkComplete() {
    if (!progressKey) return;
    // Ensure there's an entry to complete (start if the walker skipped "Start").
    if (!readCrawl(progressKey)) {
      startCrawl(
        progressKey,
        route.map((v) => v.id),
      );
    }
    const entry = markCrawlComplete(progressKey);
    applyCompletionAck(entry);
  }

  const crawlDone = isComplete(crawlProgress);

  return {
    crawlProgress,
    showCelebration,
    setShowCelebration,
    crawlDone,
    handleStartCrawl,
    handleMarkComplete,
  };
}
