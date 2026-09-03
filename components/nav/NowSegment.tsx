"use client";

import Link from "next/link";

import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";

import "./nowSegment.css";

type NowBeat = "day" | "tonight";

/**
 * Day | Tonight switch at the head of /today and /tonight.
 *
 * Two LINKS, not local state and not a radiogroup: the URL is the truth,
 * nothing is remembered, and each option is a destination a reader may open in
 * a new tab. So they keep the link role and say which one they are on with
 * `aria-current="page"`. Enter is the anchor's own activation key, and
 * lib/segmentLinkKeys.ts adds Space, because a control shaped like a segmented
 * switch is pressed with either.
 */
export default function NowSegment({ current }: { current: NowBeat }) {
  return (
    <nav className="nowSegment" aria-label="Now">
      <Link prefetch={false}
        href="/today"
        className="nowSegmentOpt"
        aria-current={current === "day" ? "page" : undefined}
        onKeyDown={handleSegmentLinkKeyDown}
      >
        Day
      </Link>
      <Link prefetch={false}
        href="/tonight"
        className="nowSegmentOpt"
        aria-current={current === "tonight" ? "page" : undefined}
        onKeyDown={handleSegmentLinkKeyDown}
      >
        Tonight
      </Link>
    </nav>
  );
}
