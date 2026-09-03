"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { OutCardBody } from "@/components/out/OutCard";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { OutOpenPlanCard } from "@/components/out/OutOpenPlanCard";
import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import EditorialRail from "@/components/out/EditorialRail";
import { useOutListings } from "@/components/out/useOutListings";
import { trackEvent } from "@/lib/analytics";
import { outCardSource } from "@/lib/out/attribution";
import {
  groupOutListings,
  outOpenPlansSectionVisible,
  outUnmatchedListingsNotice,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import {
  OUT_DAY_WINDOWS,
  OUT_OPEN_PLANS_WAY_LABEL,
  outListingsSectionTitle,
  type OutDayWindow,
} from "@/lib/outListings";
import {
  OUT_MAP_WAY,
  OUT_RETRY_LABEL,
  outEmptyLane,
  outStatusLines,
} from "@/lib/out/outStatus";
import EmptyState from "@/components/EmptyState";
import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./out.css";

const DAY_LABEL: Record<OutDayWindow, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

export default function OutClient({ day }: { day: OutDayWindow }) {
  const { body, failed, pending, retry } = useOutListings(day);

  useEffect(() => {
    trackEvent("out_screen_view");
  }, []);

  const onOpen = useCallback((row: WhatsOnRow) => {
    trackEvent("out_card_opened", { source: outCardSource(row.source.label) });
  }, []);

  const listingRows = body?.events ?? [];
  const listingGroups = groupOutListings(listingRows);
  const unmatchedNotice = outUnmatchedListingsNotice(
    listingRows,
    day,
    body?.venueMatch,
    {
      unmatchedCount: body?.unmatchedCount,
      unmatchedPlaces: body?.unmatchedPlaces,
      unmatchedPlaceCount: body?.unmatchedPlaceCount,
      unmatchedSources: body?.unmatchedSources,
    },
  );
  const openPlansPreview = body?.openPlansStatus === "preview";
  const openPlansDegraded = body?.openPlansStatus === "degraded";
  const sendablePlans = sendableOpenPlans(body?.openPlans ?? []);
  // A lane with nothing in it is a card with one way onward, never a bare
  // sentence over an empty page. The lines are the ones the lane already said.
  const emptyLane = outEmptyLane({ body, failed, pending });
  const showOpenPlans =
    !openPlansPreview &&
    !openPlansDegraded &&
    outOpenPlansSectionVisible(body?.openPlans ?? []);

  return (
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      <header className="outHead">
        <h1 className="outTitle">Out</h1>
        <nav className="outDayChips" aria-label="When">
          {OUT_DAY_WINDOWS.map((windowKey) => {
            const selected = windowKey === day;
            const href = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
            return (
              <Link prefetch={false}
                key={windowKey}
                href={href}
                className="outDayChip"
                aria-current={selected ? "page" : undefined}
                onKeyDown={handleSegmentLinkKeyDown}
                onClick={() => trackEvent("out_filter_select", { kind: windowKey })}
              >
                {DAY_LABEL[windowKey]}
              </Link>
            );
          })}
        </nav>
      </header>

      <section className="outListings" aria-labelledby="out-listings-heading">
        <h2 id="out-listings-heading" className="outSectionTitle">
          {outListingsSectionTitle(day)}
        </h2>
        {pending ? <ListingsSkeleton /> : null}
        {emptyLane ? (
          <EmptyState
            className="emptyState--flush"
            title={emptyLane.lines[0]}
            body={emptyLane.lines.slice(1).join(" ") || undefined}
            actionTone="accent"
            action={
              emptyLane.way === "retry" ? (
                <button type="button" onClick={retry}>
                  {OUT_RETRY_LABEL}
                </button>
              ) : (
                <Link prefetch={false} href={OUT_MAP_WAY.href}>
                  {OUT_MAP_WAY.label}
                </Link>
              )
            }
          />
        ) : (
          outStatusLines({ body, failed }).map((line) => (
            <p className="outStatus" key={line}>
              {line}
            </p>
          ))
        )}
        <div className="outListingSurface">
          {listingGroups.map((group) => (
            <section
              key={group.key}
              className="outGroup"
              aria-labelledby={`out-group-${group.key}`}
            >
              <h3 id={`out-group-${group.key}`} className="outGroupTitle">
                {group.label}
              </h3>
              <ul className="outGroupList">
                {group.rows.map((row) => (
                  <li key={row.id} className="outListingRow">
                    <div className="outListingGig">
                      <OutCardBody row={row} onOpen={() => onOpen(row)} titleLevel={4} />
                    </div>
                    <OutListingPubPair row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {/* The honesty line comes AFTER the listings it is honest about. It led
            the page, so a reader met "57 more listings are at places we don't
            list yet" before the one listing we DO have - and the word "more"
            was answering nothing. */}
        {unmatchedNotice ? (
          <div className="outListingUnmatched" role="status" data-testid="out-unmatched-notice">
            <p className="outStatus outListingUnmatchedLine">
              {unmatchedNotice.line} {unmatchedNotice.places}
            </p>
            {unmatchedNotice.credits.length > 0 ? (
              <p className="outListingUnmatchedCredit">
                Listings from{" "}
                {unmatchedNotice.credits.map((credit, index) => (
                  <span key={credit.label}>
                    {index > 0 ? " and " : ""}
                    <a href={credit.url} rel="noopener noreferrer" target="_blank">
                      {credit.label}
                    </a>
                  </span>
                ))}
                .
              </p>
            ) : null}
            <p className="outListingUnmatchedWay">
              <Link prefetch={false} href={unmatchedNotice.way.href} className="outPlansFootLink">
                {unmatchedNotice.way.label}
              </Link>
            </p>
          </div>
        ) : null}
      </section>

      <EditorialRail />

      {openPlansPreview ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <p className="outStatus" role="status">Open plans are in preview.</p>
        </section>
      ) : openPlansDegraded ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <EmptyState
            className="emptyState--flush"
            title="Open plans could not be checked."
            role="alert"
            actionTone="accent"
            action={
              <button type="button" onClick={retry}>
                {OUT_RETRY_LABEL}
              </button>
            }
          />
        </section>
      ) : showOpenPlans ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <ul className="outOpenPlanList">
            {sendablePlans.map((plan) => (
              <OutOpenPlanCard key={plan.crewId} plan={plan} />
            ))}
          </ul>
          <p className="outPlansFoot">
            <Link prefetch={false} href="/plan" className="outPlansFootLink">
              {OUT_OPEN_PLANS_WAY_LABEL}
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
