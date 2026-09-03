"use client";

import { useEffect, useState } from "react";

import {
  completedCrawlCount,
  crawlQuestChips,
  placeQuestEventChips,
  type CrawlQuestChip,
} from "@/lib/crawlCompletion";
import {
  nextBadgeProgress,
  normalizeHandle,
  profileStats,
  type BadgeProgress,
  type ProfileDrop,
} from "@/lib/profiles";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./nextBadgeChips.css";

// Quest chips (IDEAS B2-lite): forward-looking "next badge" progress for the
// viewer's self-asserted handle. Self-contained on purpose — it resolves the
// handle the same way /activity does (localStorage `pubmax_handle`, read AFTER
// mount so server render and hydration agree), fetches the public drops, and
// computes progress with the pure lib/profiles helpers. Honesty rules:
//  • no handle → renders nothing (no invented identity);
//  • fetch failed → renders nothing (a guess is worse than silence);
//  • every badge earned → renders nothing (no fake quests).
// A `handle` prop skips the localStorage read when the parent already knows it.
// Loop 2 / Wave G2: optionally shows crawl-walked + Place-story quest chips from
// local crawlCompletion when `showCrawlsWalked` is set (own-device progress only).

const HANDLE_KEY = "pubmax_handle";
const MAX_CHIPS = 2;

export default function NextBadgeChips({
  handle,
  showCrawlsWalked = false,
}: {
  handle?: string;
  showCrawlsWalked?: boolean;
}): React.JSX.Element | null {
  const [quests, setQuests] = useState<BadgeProgress[]>([]);
  const [crawlsWalked, setCrawlsWalked] = useState(0);
  const [crawlQuests, setCrawlQuests] = useState<CrawlQuestChip[]>([]);
  const [eventQuests, setEventQuests] = useState<CrawlQuestChip[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const resolved = normalizeHandle(
        handle ??
          (typeof window === "undefined" ? "" : (window.localStorage.getItem(HANDLE_KEY) ?? "")),
      );
      if (!resolved) return;
      await loadSurfaceJson<unknown>(
        `/api/pint-drops?author=${encodeURIComponent(resolved)}`,
        {
          signal: controller.signal,
          validate: (body) =>
            Boolean(
              body &&
                typeof body === "object" &&
                Array.isArray((body as { drops?: unknown }).drops),
            ),
        },
        (body) => {
          const all: ProfileDrop[] =
            body && typeof body === "object" && Array.isArray((body as { drops?: unknown }).drops)
              ? ((body as { drops: ProfileDrop[] }).drops ?? [])
              : [];
          const mine = all.filter((d) => normalizeHandle(d.handle) === resolved);
          if (controller.signal.aborted) return;
          setQuests(nextBadgeProgress(mine, profileStats(mine)));
        },
      );
    }

    void load();
    return () => controller.abort();
  }, [handle]);

  useEffect(() => {
    if (!showCrawlsWalked) return;
    let active = true;
    async function loadWalked() {
      const next = completedCrawlCount();
      const chips = crawlQuestChips();
      const events = placeQuestEventChips();
      if (active) {
        setCrawlsWalked(next);
        setCrawlQuests(chips);
        setEventQuests(events);
      }
    }
    void loadWalked();
    return () => {
      active = false;
    };
  }, [showCrawlsWalked]);

  // Event chips are always returned (time-boxed quests), so they must not alone
  // keep this section mounted when the user has no crawl / badge progress yet.
  const hasWalkedChip =
    showCrawlsWalked && (crawlsWalked > 0 || crawlQuests.length > 0);
  if (quests.length === 0 && !hasWalkedChip) return null;

  return (
    <div className="questChips" aria-label="Next badge progress">
      {quests.length > 0 ? <span className="questChipsKicker">Next badge</span> : null}
      {quests.slice(0, MAX_CHIPS).map((quest) => (
        <span key={quest.badge.id} className="questChip">
          <span className="questChipCount">
            {quest.current}/{quest.target}
          </span>
          {quest.label}
        </span>
      ))}
      {showCrawlsWalked
        ? eventQuests.map((chip) => (
            <span key={chip.id} className="questChip questChipEvent">
              <span className="questChipCount">
                {chip.current}/{chip.target}
              </span>
              {chip.label}
              {chip.windowLabel ? (
                <span className="questChipWindow"> · {chip.windowLabel}</span>
              ) : null}
            </span>
          ))
        : null}
      {showCrawlsWalked
        ? crawlQuests.map((chip) => (
            <span key={chip.id} className="questChip questChipWalked">
              <span className="questChipCount">
                {chip.current}/{chip.target}
              </span>
              {chip.label}
            </span>
          ))
        : null}
      {showCrawlsWalked && crawlsWalked > 0 && crawlQuests.length === 0 ? (
        <span className="questChip questChipWalked">
          <span className="questChipCount">{crawlsWalked}</span>
          Crawls walked
        </span>
      ) : null}
    </div>
  );
}
