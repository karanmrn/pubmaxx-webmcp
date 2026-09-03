"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Copy, MapPin, Flag } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { decodeCrawlStory, totalGbp, type CrawlStory } from "@/lib/crawlStory";
import { curatedCrawlMapHref, curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { landmarks } from "@/lib/landmarks";
import { bandById } from "@/lib/storyBands";
import { getRoutePack, routePacks } from "@/lib/routePacks";
import { formatGbp } from "@/lib/formatGbp";
import { loadSlimVenues, type SlimVenue } from "@/lib/venuesSlim";
import SiteNav from "@/components/nav/SiteNav";
import RoundStarter from "@/components/round/RoundStarter";
import RouteThumbnail from "./RouteThumbnail";
import {
  buildCrawlRouteSummary,
  crawlPriceRange,
  formatCrawlRouteSummary,
  formatPriceRange,
} from "./routeSummary";
import "./crawls.css";

// The landmark a crawl starts at (story 27) — "starts at Big Ben"-style chip.
// Undefined when the crawl carries no startLandmarkId, or it points at an id
// that isn't a real landmark (defensive: never crash the crawls page over a
// stale reference).
function startLandmarkName(crawl: CuratedCrawl): string | undefined {
  if (!crawl.startLandmarkId) return undefined;
  return landmarks.find((lm) => lm.id === crawl.startLandmarkId)?.name;
}

// Turn a camelCase CrawlStyle ("writerTrail") into a human badge label
// ("Writer Trail"). Single-word styles ("heritage") just get capitalised.
function styleLabel(style: string): string {
  return style
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

// The compact groups are keyed by style label. The heritage rail leads (the
// cohort review found the older, quiet-pint drinker under-served here) and reads
// in the page's calm voice rather than a bare machine label. Every other group
// keeps its plain style label; a head that isn't overridden falls through to it.
const HERITAGE_GROUP_LABEL = styleLabel("heritage");
const GROUP_HEAD: Record<string, string> = {
  [HERITAGE_GROUP_LABEL]: "Heritage routes, handed down",
};

function groupHead(label: string): string {
  return GROUP_HEAD[label] ?? label;
}

// Reproduce a crawl on the map from a story's stop ids, matching the existing
// share-URL format read by seedCrawlState (mode=build&pubs=id1,id2). Stops that
// carry no venueId (e.g. a hand-authored story) just aren't planned back.
function planCrawlHref(story: CrawlStory): string {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

function CrawlsPageInner() {
  // useSearchParams so client navigations between ?pack= links re-filter the
  // curated grid (a mount-only window.location read would stick on the first pack).
  const searchParams = useSearchParams();
  const activePackId = searchParams.get("pack");
  const activePack = activePackId ? getRoutePack(activePackId) : undefined;
  const activePackCrawlIds = activePack ? new Set(activePack.crawlIds) : null;
  const visibleCrawls = activePackCrawlIds
    ? curatedCrawls.filter((crawl) => activePackCrawlIds.has(crawl.id))
    : curatedCrawls;

  // Read ?s= from the live search params so client navigations stay in sync.
  // decode never throws, so a garbage param falls through to the empty state.
  const story = useMemo<CrawlStory | null>(
    () => decodeCrawlStory(searchParams.get("s")),
    [searchParams],
  );

  // Slim venue index — the only client-safe source of stop coords + price, used
  // to derive HONEST route metrics for the curated cards (E4). Loaded once on
  // mount (same pattern as the Round route list); until it lands slimById is
  // empty and the cards simply render without metrics rather than guessing.
  const [slimVenues, setSlimVenues] = useState<SlimVenue[]>([]);
  const [venueIndexStatus, setVenueIndexStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let active = true;
    void loadSlimVenues()
      .then((venues) => {
        if (!active) return;
        setSlimVenues(venues);
        setVenueIndexStatus("ready");
      })
      .catch(() => {
        if (active) setVenueIndexStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);
  const slimById = useMemo(
    () => new Map(slimVenues.map((v) => [v.id, v])),
    [slimVenues],
  );

  // ONE featured crawl up top (full card, route viz) + the rest as compact
  // scannable rows grouped by crawlStyle theme — the "wall of 15 identical
  // cards" from the mobile audit read as generated filler. Every crawl stays
  // reachable (featured + every group row), nothing is dropped, no repeated
  // full-card layout.
  const featuredCrawl = visibleCrawls[0];
  const remainingCrawls = visibleCrawls.slice(1);
  const compactGroups = useMemo<[string, CuratedCrawl[]][]>(() => {
    const order: string[] = [];
    const byLabel = new Map<string, CuratedCrawl[]>();
    for (const crawl of remainingCrawls) {
      const label = styleLabel(crawl.crawlStyle);
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        order.push(label);
      }
      byLabel.get(label)!.push(crawl);
    }
    // Lift the heritage rail to the top; everything else keeps its first-seen
    // order (stable). Nothing is dropped, every crawl stays reachable.
    const ordered = order
      .map((label, index) => ({ label, index }))
      .sort((a, b) => {
        const aHeritage = a.label === HERITAGE_GROUP_LABEL ? 0 : 1;
        const bHeritage = b.label === HERITAGE_GROUP_LABEL ? 0 : 1;
        return aHeritage - bHeritage || a.index - b.index;
      })
      .map((entry) => entry.label);
    return ordered.map((label) => [label, byLabel.get(label)!]);
  }, [remainingCrawls]);

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copyShareLink() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <main
      id="main"
      className="crawlsShell"
      aria-busy={venueIndexStatus === "loading"}
      data-venue-index-status={venueIndexStatus}
    >
      <SiteNav active="crawls" />

      {story ? (
        <CrawlPoster story={story} copied={copied} copyError={copyError} onCopy={copyShareLink} />
      ) : (
        <section className="crawlEmpty" aria-labelledby="crawlsHeading">
          <p className="crawlEyebrow">Crawls worth walking</p>
          <h1 id="crawlsHeading">Pub stories mapped into walks.</h1>
          <p className="crawlEmptyBody">
            A Crawl Story is a shareable poster of a London pub crawl, the stops, the prices,
            the vibe. Here are a few listed routes worth the walk. Pick one, or start your own
            on the map.
          </p>

          <nav className="routePackNav" aria-labelledby="routePacksHeading">
            <p className="crawlEyebrow" id="routePacksHeading">
              Jump to a route pack
            </p>
            <ul className="routePackChipRow">
              {routePacks.map((pack) => {
                const browseHref = `/crawls?pack=${encodeURIComponent(pack.id)}`;
                const isBrowsing = activePackId === pack.id;
                const n = pack.crawlIds.length;
                return (
                  <li key={pack.id}>
                    <Link
                      href={browseHref}
                      className={isBrowsing ? "routePackChip isActive" : "routePackChip"}
                      aria-current={isBrowsing ? "true" : undefined}
                      title={pack.blurb}
                    >
                      {pack.title}
                      <span className="routePackChipCount">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {activePack ? (
              <p className="routePackActiveNote">
                Showing {activePack.title} routes.{" "}
                <Link href="/crawls">Show all crawls</Link>
              </p>
            ) : null}
          </nav>

          {featuredCrawl ? (
            <FeaturedCrawlCard crawl={featuredCrawl} slimById={slimById} />
          ) : null}

          {compactGroups.length ? (
            <div className="crawlCompactGroups">
              {compactGroups.map(([groupLabel, crawlsInGroup]) => (
                <section
                  key={groupLabel}
                  className="crawlCompactGroup"
                  aria-labelledby={`crawlGroup-${groupLabel.replace(/\s+/g, "-")}`}
                >
                  <h3
                    id={`crawlGroup-${groupLabel.replace(/\s+/g, "-")}`}
                    className="crawlCompactGroupHeading"
                  >
                    {groupHead(groupLabel)}
                  </h3>
                  <ul className="crawlCompactList" aria-label={`${groupLabel} crawls`}>
                    {crawlsInGroup.map((crawl) => (
                      <CompactCrawlRow key={crawl.id} crawl={crawl} slimById={slimById} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}

          <RoundStarter />

          <p className="crawlEmptyBody crawlOwnLead">
            Or build your own. Pick the pubs, pass the round on.
          </p>
          <Link href="/map" className="crawlPrimaryBtn">
            <MapPin size={16} aria-hidden="true" /> Build your own crawl on the map
          </Link>
        </section>
      )}
    </main>
  );
}

// The one full-width card at the top of the empty state — keeps the route
// thumbnail + honest metrics that made the old grid nice, minus the
// repetition of shipping 15 of them.
function FeaturedCrawlCard({
  crawl,
  slimById,
}: {
  crawl: CuratedCrawl;
  slimById: ReadonlyMap<string, SlimVenue>;
}) {
  const originName = startLandmarkName(crawl);
  const placeStory = crawl.placeStoryBandId ? bandById(crawl.placeStoryBandId) : undefined;
  const routeSummary = buildCrawlRouteSummary(crawl.venueIds, slimById);
  const priceRange = crawlPriceRange(crawl.venueIds, slimById);

  return (
    <div className="curatedFeaturedWrap">
      <p className="crawlEyebrow curatedFeaturedEyebrow">Featured crawl</p>
      <article key={crawl.id} id={crawl.id} className="curatedCard curatedFeaturedCard">
        <span className="curatedBadge">{styleLabel(crawl.crawlStyle)}</span>
        <h2 className="curatedName">{crawl.name}</h2>
        <p className="curatedBlurb">{crawl.blurb}</p>
        {routeSummary ? (
          <div className="curatedRoute">
            <RouteThumbnail points={routeSummary.points} className="curatedRouteThumb" />
            <span className="curatedRouteMeta">{formatCrawlRouteSummary(routeSummary)}</span>
          </div>
        ) : null}
        {priceRange ? (
          <span className="curatedPriceFrom">Pints from {formatPriceRange(priceRange)}</span>
        ) : null}
        {originName ? (
          <span className="curatedOriginChip">
            <Flag size={12} aria-hidden="true" /> Starts at {originName}
          </span>
        ) : null}
        {placeStory ? (
          <span className="curatedOriginChip curatedPlaceStoryChip">
            Place story · {placeStory.title}
          </span>
        ) : null}
        <p className="curatedMeta">
          {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
        </p>
        <Link
          href={curatedCrawlMapHref(crawl)}
          className="curatedLink curatedPlanBtn"
          aria-label={`Plan the ${crawl.name} crawl on the map`}
        >
          Plan this crawl →
        </Link>
      </article>
    </div>
  );
}

// Compact scannable row for every other curated crawl — name, area (the
// landmark it starts at, when known), stop count, price range. One line,
// tap anywhere to open the crawl on the map (its existing "detail" surface —
// curated crawls have no standalone detail page; /crawls/[slug] is reserved
// for durable, user-shared Crawl Stories, a different id namespace).
function CompactCrawlRow({
  crawl,
  slimById,
}: {
  crawl: CuratedCrawl;
  slimById: ReadonlyMap<string, SlimVenue>;
}) {
  const originName = startLandmarkName(crawl);
  const priceRange = crawlPriceRange(crawl.venueIds, slimById);
  const stopCount = crawl.venueIds.length;

  return (
    <li className="crawlCompactRow">
      <Link
        href={curatedCrawlMapHref(crawl)}
        className="crawlCompactLink"
        aria-label={`Plan the ${crawl.name} crawl on the map`}
      >
        <span className="crawlCompactName">{crawl.name}</span>
        <span className="crawlCompactMetaRow">
          {originName ? <span className="crawlCompactArea">{originName}</span> : null}
          <span className="crawlCompactStops">
            {stopCount} stop{stopCount === 1 ? "" : "s"}
          </span>
          <span className="crawlCompactPrice">
            {priceRange ? formatPriceRange(priceRange) : "–"}
          </span>
        </span>
      </Link>
    </li>
  );
}

function CrawlPoster({
  story,
  copied,
  copyError,
  onCopy,
}: {
  story: CrawlStory;
  copied: boolean;
  copyError: string;
  onCopy: () => void;
}) {
  const total = totalGbp(story);
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;

  return (
    <article className="crawlPoster">
      <header className="crawlPosterHead">
        <p className="crawlEyebrow">A London crawl</p>
        <h1>{story.title || "An untitled crawl"}</h1>
        {story.caption ? <p className="crawlCaption">{story.caption}</p> : null}
        {story.vibeTags.length ? (
          <ul className="crawlTags" aria-label="Crawl vibe tags">
            {story.vibeTags.map((tag) => (
              <li key={tag} className="crawlTag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <ol className="crawlStops">
        {story.stops.map((stop, index) => (
          <li key={`${stop.venueId || stop.name}-${index}`} className="crawlStop">
            <span className="crawlStopNumber" aria-hidden="true">
              {index + 1}
            </span>
            <div className="crawlStopBody">
              <strong>{stop.name}</strong>
              {stop.note ? <p className="crawlStopNote">{stop.note}</p> : null}
            </div>
            <span className="crawlStopPrice">
              {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "–"}
            </span>
          </li>
        ))}
      </ol>

      <div className="crawlReceipt" role="group" aria-label="Crawl total">
        <span>
          Round total
          <small>
            {pricedStops} of {story.stops.length} stop{story.stops.length === 1 ? "" : "s"} priced
          </small>
        </span>
        <strong>{formatGbp(total)}</strong>
      </div>

      <div className="crawlActions">
        <Link href={planCrawlHref(story)} className="crawlPrimaryBtn">
          <MapPin size={16} aria-hidden="true" /> Plan this crawl
        </Link>
        <button type="button" className="crawlSecondaryBtn" onClick={onCopy}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {/* aria-live announces the "Copied" confirmation to screen readers
              without needing a separate status region — the button's own
              accessible name updates and is polite (non-interrupting). */}
          <span aria-live="polite">{copied ? "Copied" : "Copy share link"}</span>
        </button>
        {copyError ? <p role="status">{copyError}</p> : null}
      </div>

      <p className="crawlFootnote">Pubs, prices and the route between them.</p>
    </article>
  );
}

export default function CrawlsPageClient() {
  // Suspense boundary required by Next.js when a client page uses useSearchParams
  // during static prerender — without it, /crawls fails the production build.
  return (
    <Suspense fallback={<main id="main" className="crawlsShell" aria-busy="true" />}>
      <CrawlsPageInner />
    </Suspense>
  );
}
