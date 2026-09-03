"use client";

import { createPortal } from "react-dom";
import { Flag, PlusCircle, Route as RouteIcon, Share2 } from "lucide-react";

import type { Venue } from "@/lib/venues";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { ShareFeedback } from "@/lib/venueShare";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import { isPubVenue } from "@/lib/venueKindFilters";

export default function VenueStickyBar({
  venue,
  mode,
  inCrawl,
  onToggleStop,
  onAcceptStop1,
  acceptanceError,
  onAddPrice,
  shareVenue,
  currentShareFeedback,
}: {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  onToggleStop: (id: string) => void;
  /** Trusted-handoff §4.8: accept this Venue as Stop 1. */
  onAcceptStop1?: () => void;
  acceptanceError?: string | null;
  onAddPrice: () => void;
  shareVenue: () => Promise<void>;
  currentShareFeedback: ShareFeedback | null;
}) {
  // Inside the mobile portal sheet, render into the footer slot (a flex child
  // OUTSIDE the scroll body) so the bar is always visible above scrolling
  // content and rides 1:1 with the sheet on drag/snap. Outside the sheet
  // (desktop) the context is null, so it renders in place as a sticky footer.
  const footerSlot = useSheetFooterSlot();
  const pubVenue = isPubVenue(venue);
  const bar = (
    <div className="venueSheetStickyBar" role="toolbar" aria-label="Venue actions">
      {pubVenue && onAcceptStop1 ? (
        <button
          type="button"
          className="venueSheetStickyPrimary"
          onClick={onAcceptStop1}
          aria-label={`Make ${venue.name} Stop 1`}
        >
          <Flag size={16} aria-hidden="true" />
          Make it Stop 1
        </button>
      ) : null}
      {pubVenue ? (
        <button
          type="button"
          className={onAcceptStop1 ? "venueSheetStickyGhost" : "venueSheetStickyPrimary"}
          onClick={onAddPrice}
          aria-label={`Add a price at ${venue.name}`}
        >
          <PlusCircle size={16} aria-hidden="true" />
          Add price
        </button>
      ) : null}
      {pubVenue && mode === "build" ? (
        <button
          type="button"
          className="venueSheetStickyGhost"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          <RouteIcon size={15} aria-hidden="true" />
          {inCrawl ? "Remove" : "Crawl"}
        </button>
      ) : null}
      <button
        type="button"
        className="venueSheetStickyGhost"
        onClick={() => {
          void shareVenue();
        }}
        aria-label={`Share ${venue.name}`}
      >
        <Share2 size={15} aria-hidden="true" />
        Share
      </button>
      {/* No Train button here: the tab row's "Train" (getting-home) tab is the
          single entry point — the strip holds actions, not navigation. */}
      {currentShareFeedback ? (
        <span
          role={currentShareFeedback.tone === "error" ? "alert" : "status"}
          className={`venueSheetShareFeedback ${currentShareFeedback.tone}`}
        >
          {currentShareFeedback.text}
        </span>
      ) : null}
      {acceptanceError ? (
        <span role="alert" className="venueSheetShareFeedback error">
          {acceptanceError}
        </span>
      ) : null}
    </div>
  );

  return footerSlot ? createPortal(bar, footerSlot) : bar;
}
