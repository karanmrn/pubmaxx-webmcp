"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { discardBody } from "@/lib/responseBody";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import {
  cheapestPints,
  cheapestTonight,
  type LeaderboardEntry,
  type TonightDrop,
  type TonightEntry,
} from "@/lib/leaderboard";
import { computeThenVsNow, type ThenVsNowItem } from "@/lib/thenVsNow";
import LeaderboardTable from "@/components/discovery/LeaderboardTable";
import CityRivalryTable from "@/components/discovery/CityRivalryTable";
import TonightBoard from "@/components/discovery/TonightBoard";
import EditorialCard, { type EditorialCardData } from "@/components/discovery/EditorialCard";
import TonightMapPointer from "@/components/discovery/TonightMapPointer";
import MusicTonightLane from "@/components/discovery/MusicTonightLane";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import GardenTonightCard from "@/components/discovery/GardenTonightCard";
import ThenVsNowCard from "@/components/discovery/ThenVsNowCard";
import SiteNav from "@/components/nav/SiteNav";
import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
import { brandsForCategory } from "@/lib/drinkBrands";
import {
  categoryLabel,
  MAP_LENS_DRINK_CATEGORIES,
  type DrinkCategory,
} from "@/lib/drinks";
import { KNOWN_CUISINE_TAGS } from "@/lib/cuisineTags";
import type { CityRivalryEntry } from "@/lib/cityRivalry";
import { runDiscoverAnalysisLoad, scheduleDiscoverAnalysisLoad } from "@/lib/discoverLazy";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import {
  readPreferredCity,
  subscribePreferredCity,
  preferredCityMapHref,
} from "@/lib/cityPreference";
import {
  cityAwareMapPath,
  curatedCrawlById,
  curatedCrawlMapHref,
  type CuratedCrawl,
} from "@/lib/curatedCrawls";
import { getRoutePack, routePackPrimaryCrawl } from "@/lib/routePacks";
import NightAreaCoverage from "@/components/night/NightAreaCoverage";
import "./discover.css";
import "@/components/night/nightAreaCoverage.css";

/** Discover Hungry chips → map with food filter + cuisine hint in the query. */
function hungryCuisineHref(tag: string, cityId: CityId): string {
  const params = new URLSearchParams({ food: "1", q: tag });
  return cityAwareMapPath(cityId, params);
}

/** Cuisine chips shown on Discover — a short, scannable subset. */
const DISCOVER_CUISINE_CHIPS = [
  "roast",
  "gastropub",
  "burger",
  "pizza",
  "tapas",
  "pie",
  "thai",
  "italian",
] as const satisfies ReadonlyArray<(typeof KNOWN_CUISINE_TAGS)[number]>;

/** Brand jump chips — beer + wine only (honest coverage on the map). */
const JUMP_BY_BRAND_CATEGORIES = ["beer", "wine"] as const satisfies ReadonlyArray<DrinkCategory>;

/**
 * Discover lede lists every drink the map can lens, derived from
 * `MAP_LENS_DRINK_CATEGORIES` so a new lens (coffee today) cannot drift out of
 * the browse sentence. `alcohol-free` keeps the noun "drinks" so the bare
 * adjective does not hang in the list.
 */
export function discoverDrinkBrowseLede(
  categories: readonly DrinkCategory[] = MAP_LENS_DRINK_CATEGORIES,
): string {
  const labels = categories.map((category) => {
    const label = categoryLabel(category).toLocaleLowerCase("en-GB");
    return category === "alcohol-free" ? "alcohol-free drinks" : label;
  });
  if (labels.length === 0) return "Browse drinks on the map.";
  if (labels.length === 1) return `Browse ${labels[0]}.`;
  const last = labels[labels.length - 1]!;
  return `Browse ${labels.slice(0, -1).join(", ")} and ${last}.`;
}

// "Explore by drink" → /map deep-link. decodeCrawl (lib/crawlUrl) maps these:
//   cocktail → requireCocktails + drinkCategory
//   wine / spirits / beer → drinkCategory (+ optional brand)
// low-no uses LOW_NO params below (requireNonAlcoholic + mocktail alt).
function exploreHref(
  category: DrinkCategory,
  cityId: CityId,
  brandId?: string,
): string {
  const params = new URLSearchParams({ drink: category });
  if (category === "cocktail") params.set("cocktails", "1");
  if (brandId) params.set("brand", brandId);
  return cityAwareMapPath(cityId, params);
}

function hungryHref(cityId: CityId): string {
  return cityAwareMapPath(cityId, new URLSearchParams({ food: "1" }));
}

function lowNoHref(cityId: CityId): string {
  return cityAwareMapPath(
    cityId,
    new URLSearchParams({ drink: "low-no", low: "1", alt: "mocktail" }),
  );
}

/** Map-first crawl href, or city map if the curated id is missing. */
function crawlMapHref(crawlId: string, cityId: CityId): string {
  const crawl = curatedCrawlById(crawlId);
  return crawl
    ? curatedCrawlMapHref(crawl, cityId)
    : cityAwareMapPath(cityId);
}

/** Map-first pack lead crawl, or city map if the pack is empty. */
function packMapHref(packId: string, cityId: CityId): string {
  const pack = getRoutePack(packId);
  if (!pack) return cityAwareMapPath(cityId);
  const primary = routePackPrimaryCrawl(pack);
  return primary
    ? curatedCrawlMapHref(primary, cityId)
    : cityAwareMapPath(cityId);
}

// Static editorial lanes. Each CTA opens /map with a real crawl polyline
// (curatedCrawlMapHref / routePackMapHref) — not a bare filter or list page.
// These crawls are London editorial (Soho / Barbican / packs). Always omit an
// explicit preferredCity so venue-derived city wins — never ship Victorian Soho
// onto `/map/manchester` just because the viewer last chose Manchester.
function buildEditorial(): EditorialCardData[] {
  return [
    {
      id: "golden-days",
      eyebrow: "Golden days",
      title: "The old guard, still standing",
      dek: "Victorian gin palaces, listed snugs, and the bar Dickens leaned on.",
      href: crawlMapHref("victorian-soho", DEFAULT_CITY_ID),
      cta: "Walk Victorian Soho",
    },
    {
      id: "coding-pint",
      eyebrow: "Coding pint",
      title: "A quiet table and a slow pint",
      dek: "Pubs with sockets, listed Wi-Fi and quieter afternoon notes.",
      href: crawlMapHref("barbican-coding-pint", DEFAULT_CITY_ID),
      cta: "Find a working pint",
    },
    {
      id: "then-vs-now",
      eyebrow: "Then vs now",
      title: "What a pint used to cost",
      dek: "Listed pints around £4, mapped into a walk.",
      href: packMapHref("cheap-chaos", DEFAULT_CITY_ID),
      cta: "Build a cheap crawl",
    },
    {
      id: "tonights-crawl",
      eyebrow: "Tonight",
      title: "Tonight's crawl, sorted",
      dek: "Pick a borough and set your price before opening the route on the map.",
      href: packMapHref("late-train", DEFAULT_CITY_ID),
      cta: "Plan an outing",
    },
  ];
}

/** Exported for unit tests — Discover editorial CTAs must stay map-first. */
export const DISCOVER_EDITORIAL = buildEditorial();

// Narrow the public /api/pint-drops payload to the drop shape our compute
// helpers read. The returned TonightDrop carries {venueId, priceGbp, createdAt}
// (all computeThenVsNow needs) PLUS the optional {handle, venueName} the tonight
// board shows — the same list feeds both sections (one fetch, two computes).
// Defensive: any malformed body yields an empty list so the sections simply
// don't render (never crashes the page).
function pickDrops(raw: unknown): TonightDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return [];
  const out: TonightDrop[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.venueId !== "string" || !d.venueId) continue;
    out.push({
      venueId: d.venueId,
      priceGbp:
        typeof d.priceGbp === "number" && Number.isFinite(d.priceGbp) ? d.priceGbp : null,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
      handle: typeof d.handle === "string" && d.handle.trim() ? d.handle : undefined,
      venueName:
        typeof d.venueName === "string" && d.venueName.trim() ? d.venueName : undefined,
    });
  }
  return out;
}

// Generated heritage crawls → EditorialCard shape. Each card opens the SAME
// map deep-link the curated crawls use (curatedCrawlMapHref), so the polyline +
// stops hydrate identically — no parallel map-link format. London-authored, so
// (like buildEditorial) we omit an explicit city and let the venue-derived city
// win via DEFAULT_CITY_ID.
const HERITAGE_CTA_LABELS: Readonly<Record<string, string>> = {
  "heritage-oldest-pubs": "Start with the oldest",
  "heritage-riverside-taverns": "Walk the Thames taverns",
  "heritage-grade-listed": "See the listed classics",
};

function heritageCrawlCards(crawls: CuratedCrawl[]): EditorialCardData[] {
  return crawls.map((crawl) => ({
    id: `heritage-${crawl.id}`,
    eyebrow: "Historic London",
    title: crawl.name,
    dek: crawl.blurb,
    href: curatedCrawlMapHref(crawl, DEFAULT_CITY_ID),
    cta: HERITAGE_CTA_LABELS[crawl.id] ?? "Open this heritage route",
  }));
}

type DiscoverPageClientProps = {
  rivalry: CityRivalryEntry[];
  heritageCrawls: CuratedCrawl[];
  embedded?: boolean;
};

export function DiscoverBody({
  rivalry,
  heritageCrawls,
  embedded = false,
}: DiscoverPageClientProps) {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    () => readPreferredCity() ?? DEFAULT_CITY_ID,
    () => DEFAULT_CITY_ID, // SSR snapshot
  );
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  // "Then vs Now" is best-effort and independent of the leaderboard: it needs
  // BOTH the dataset (for baseline prices + names) and the community drops. If
  // either fetch fails we just leave this empty and show a friendly note — the
  // rest of the page is unaffected.
  const [thenVsNow, setThenVsNow] = useState<ThenVsNowItem[]>([]);
  // "Cheapest pints logged tonight" (PRD §5.1): the live hook. Computed from the
  // SAME community drops as Then vs Now (one fetch, two computes) — the cheapest
  // priced drops in the trailing 24h. Empty until the drops land; if the drops
  // fetch fails it simply stays empty and the board shows its friendly note.
  const [tonight, setTonight] = useState<TonightEntry[]>([]);
  const analysisRef = useRef<HTMLElement | null>(null);
  const revealRootRef = useRef<HTMLElement | null>(null);
  const setRevealRoot = useCallback((node: HTMLElement | null) => {
    revealRootRef.current = node;
  }, []);

  // Editorial stays London-authored; drink/food chips still follow preferred city.
  const editorial = buildEditorial();
  // Generated heritage routes render in the additive "Historic London" section.
  const heritageCards = heritageCrawlCards(heritageCrawls);
  const hungryMapHref = hungryHref(preferredCity);
  const lowNoMapHref = lowNoHref(preferredCity);
  const openMapHref = preferredCityMapHref();

  // Defer the 5.9MB public dataset until the data-heavy sections are near the
  // viewport. The route shell and drink categories can paint without competing
  // with the dataset download + grouping work on mobile.
  useEffect(() => {
    const controller = new AbortController();
    const startAnalysis = () => {
      void runDiscoverAnalysisLoad({
        signal: controller.signal,
        setStatus,
        loadDataset: async () => {
          const res = await fetch("/data/pint_prices_app_dataset.json", {
            signal: controller.signal,
          });
          if (!res.ok) {
            discardBody(res);
            throw new Error(`HTTP ${res.status}`);
          }
          const rows = (await res.json()) as VenuePrice[];
          return groupVenuePrices(Array.isArray(rows) ? rows : []);
        },
        applyDataset: (venues: Venue[]) => {
          setEntries(cheapestPints(venues, 10));
        },
        loadDrops: async () => {
          const res = await fetch("/api/pint-drops", {
            signal: controller.signal,
          });
          if (!res.ok) {
            discardBody(res);
            return [];
          }
          const body = await res.json();
          return pickDrops(body);
        },
        applyDrops: (venues: Venue[], drops: TonightDrop[]) => {
          // Same drops, two computes: the live "tonight" board (last 24h,
          // cheapest-first) and the "then vs now" baseline comparison.
          setTonight(cheapestTonight(drops, { limit: 10 }));
          setThenVsNow(computeThenVsNow(venues, drops, 8));
        },
        // Community "now" prices are best-effort: a non-abort failure still
        // leaves the rest of the page ready, with empty sections and friendly copy.
        onDropsError: () => {},
      });
    };

    const cancelScheduledLoad = scheduleDiscoverAnalysisLoad({
      target: analysisRef.current,
      start: startAnalysis,
    });

    return () => {
      cancelScheduledLoad();
      controller.abort();
    };
  }, []);

  // Scroll entrance for leaderboard / tonight / then-vs-now / editorial rows
  // (see [data-reveal] in discover.css). Reduced-motion users never get the
  // opacity:0 starting state (that rule is behind prefers-reduced-motion).
  //
  // Sibling reveal: when any row/card in a table body, list, or editorial grid
  // intersects, mark every [data-reveal] sibling revealed too. Without that, a
  // partially-visible leaderboard shows 3 rows then a void of opacity:0 rows
  // still taking layout space (the bounce void in discover-1440-dark-after).
  useEffect(() => {
    const root = revealRootRef.current;
    if (!root) return;

    const markRevealed = (el: Element) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("is-revealed");
      const parent = el.parentElement;
      if (!parent) return;
      for (const sib of parent.children) {
        if (sib instanceof HTMLElement && sib.hasAttribute("data-reveal")) {
          sib.classList.add("is-revealed");
        }
      }
    };

    const revealIntersecting = (marginPx = 160) => {
      const vh = window.innerHeight;
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > -marginPx && rect.top < vh + marginPx) {
          markRevealed(el);
        }
      });
    };

    // Data just mounted (or editorial already in the tree): immediately reveal
    // anything already near the viewport so we never paint a headed void while
    // the IntersectionObserver is still scheduling.
    revealIntersecting();

    const targets = root.querySelectorAll<HTMLElement>(
      "[data-reveal]:not(.is-revealed)",
    );
    if (targets.length === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => markRevealed(el));
      return;
    }
    const observer = new IntersectionObserver(
      (observedEntries) => {
        for (const observed of observedEntries) {
          if (observed.isIntersecting) {
            markRevealed(observed.target);
            observer.unobserve(observed.target);
          }
        }
      },
      // Generous rootMargin so below-fold siblings of a visible table arm
      // before the user sees an empty void; threshold 0 avoids flaky <tr> IO.
      { threshold: 0, rootMargin: "120px 0px 120px 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [entries, tonight, thenVsNow, heritageCards.length]);

  // Arm the [data-reveal] hidden-by-default CSS (discover.css) only once the
  // page has genuinely scrolled. Gating opacity:0 on scroll (not mount) keeps
  // one-shot full-document captures honest until the user actually moves.
  useEffect(() => {
    const root = revealRootRef.current;
    if (!root) return;
    let armed = false;
    const armReveal = () => {
      if (armed) return;
      armed = true;
      // Sync-reveal near-viewport items FIRST (with sibling fan-out) so adding
      // .revealArmed never flashes a visible table into a void of opacity:0.
      const vh = window.innerHeight;
      const marginPx = 160;
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > -marginPx && rect.top < vh + marginPx) {
          el.classList.add("is-revealed");
          const parent = el.parentElement;
          if (!parent) return;
          for (const sib of parent.children) {
            if (sib instanceof HTMLElement && sib.hasAttribute("data-reveal")) {
              sib.classList.add("is-revealed");
            }
          }
        }
      });
      root.classList.add("revealArmed");
      window.removeEventListener("scroll", armReveal);
    };
    window.addEventListener("scroll", armReveal, { passive: true, once: true });
    return () => window.removeEventListener("scroll", armReveal);
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      id={embedded ? undefined : "main"}
      className={embedded ? "discoverPage discoverPageEmbedded" : "discoverPage"}
      ref={setRevealRoot}
    >
      {!embedded ? <SiteNav active="discover" /> : null}

      {!embedded ? <header className="discoverHead">
        <p className="discoverEyebrow">Pint stories</p>
        <h1 className="discoverTitle">Pint prices, pub stories and routes worth walking.</h1>
        <p className="discoverLede">{discoverDrinkBrowseLede()}</p>
        {/* Hub rule (docs/MOBILE_FLOW_SPEC.md §1): Tonight, Feed, and Crawls have no tab
            of their own on mobile, so this page is their hub — every surface
            reachable in ≤2 taps from a tab. */}
        <nav className="discoverHubRow" aria-label="More stories">
          <Link href="/tonight" className="discoverHubLink">
            What&rsquo;s on tonight →
          </Link>
          <Link href="/social" className="discoverHubLink">
            Social →
          </Link>
          <Link href="/crawls" className="discoverHubLink">
            Crawl stories →
          </Link>
        </nav>
      </header> : null}

      <NightAreaCoverage />

      <section className="discoverSection" aria-labelledby="explore-title">
        <h2 id="explore-title" className="discoverSectionTitle">
          Choose your drink
        </h2>
        <p className="discoverSectionDek">
          Each drink family has a map colour. Pick the family you want in hand. A cheap
          pint, a house red, a gin and tonic, or the low/no option for one more
          stop before the last train.
        </p>
        <CategoryShowcase
          title=""
          hrefFor={(category) => exploreHref(category, preferredCity)}
          cardHint="Open on map"
          className="discoverExplore"
          extraItemsPosition="start"
          extraItems={
            <li
              className="catShowcase__item discoverLowNoItem"
              style={{ ["--cat" as string]: "var(--pint)" } as React.CSSProperties}
            >
              <Link
                className="catShowcase__link discoverLowNoLink"
                href={lowNoMapHref}
                aria-label="Explore low and no alcohol drinks"
              >
                <span
                  className="catShowcase__swatch discoverLowNoBadge"
                  style={{ color: "var(--pint)" }}
                  aria-hidden="true"
                >
                  Free
                </span>
                <span className="catShowcase__labelWrap">
                  <span className="catShowcase__label">Low / No</span>
                  <span className="catShowcase__hint">Open on map</span>
                </span>
              </Link>
            </li>
          }
        />

        <div
          className="discoverBrandPanel"
          aria-labelledby="discover-brand-title"
        >
          <div className="discoverBrandHead">
            <h3 id="discover-brand-title" className="discoverBrandTitle">
              Jump by brand
            </h3>
          </div>
          <p className="discoverBrandDek">
            Open a drink family on the map, or jump by brand. Beer and wine
            have the best coverage today.
          </p>
          <ul className="discoverBrandChips">
            {JUMP_BY_BRAND_CATEGORIES.flatMap((category) =>
              brandsForCategory(category).map((brand) => (
                <li key={`${category}-${brand.id}`}>
                  <Link
                    className="discoverBrandChip"
                    href={exploreHref(category, preferredCity, brand.id)}
                  >
                    {brand.label}
                  </Link>
                </li>
              )),
            )}
          </ul>
        </div>
      </section>

      <section className="discoverSection" aria-labelledby="hungry-title">
        <h2 id="hungry-title" className="discoverSectionTitle">
          Hungry?
        </h2>
        <p className="discoverSectionDek">
          Pubs that serve food. Light cuisine tags only, not full menus. Open
          the map already filtered, or jump to a plate style.
        </p>
        <div className="discoverHungryRow">
          <Link className="discoverHungryCta" href={hungryMapHref}>
            Show pubs that serve food
          </Link>
          <ul className="discoverCuisineChips" aria-label="Cuisine filters">
            {DISCOVER_CUISINE_CHIPS.map((tag) => (
              <li key={tag}>
                <Link
                  className="discoverCuisineChip"
                  href={hungryCuisineHref(tag, preferredCity)}
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        ref={analysisRef}
        className="discoverSection"
        aria-labelledby="rivalry-title"
      >
        <h2 id="rivalry-title" className="discoverSectionTitle">
          UK city energy
        </h2>
        <p className="discoverSectionDek">
          Cities ranked on Pint Drops, crawl packs, and how much ground we
          cover. Open a map and add to your
          city&rsquo;s tally.
        </p>
        <p className="discoverSectionNote">
          Seeded only where we&rsquo;ve got demo data.
        </p>
        <CityRivalryTable entries={rivalry} />
      </section>

      {/* Fail-soft: after load with zero drops, omit the whole section (heading
          included). Never leave a labeled empty board shell. Loading/error keep
          a short status so the layout does not jump while data is on the way.
          Lazy-load target stays on UK city energy above (always mounted). */}
      {status === "error" || status === "idle" || status === "loading" || tonight.length > 0 ? (
        <section
          className="discoverSection"
          aria-labelledby="tonight-title"
        >
          <h2 id="tonight-title" className="discoverSectionTitle">
            Recently logged cheap pints
          </h2>
          <p className="discoverSectionDek">
            Community prices logged in the last 24 hours, cheapest first.
          </p>
          {status === "idle" ? (
            <p className="discoverEmpty" role="status">
              Tonight&rsquo;s prices load as you reach the rankings.
            </p>
          ) : status === "loading" ? (
            <>
              <span className="srOnly" role="status">
                Loading tonight&rsquo;s prices…
              </span>
              <div className="discoverSkelList" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="discoverSkelRow">
                    <span className="discoverSkelRank" />
                    <span className="discoverSkelLine" />
                    <span className="discoverSkelPrice" />
                  </div>
                ))}
              </div>
            </>
          ) : status === "error" ? (
            <p className="discoverEmpty" role="status">
              Couldn&rsquo;t load tonight&rsquo;s prices just now.{" "}
              <Link href={openMapHref}>Open the map</Link>{" "}
              instead.
            </p>
          ) : (
            <TonightBoard entries={tonight} />
          )}
        </section>
      ) : null}

      <TonightMapPointer />

      <DealsTonightLane />

      <MusicTonightLane />

      <GardenTonightCard />

      {/* Fail-soft (journey audit P1): after load, empty data → omit the whole
          section (no permanent "Counting…" / empty shell). Loading still shows
          a short status so the layout does not jump when data is on the way. */}
      {status === "error" || status === "idle" || status === "loading" || entries.length > 0 ? (
        <section className="discoverSection" aria-labelledby="cheap-title">
          <h2 id="cheap-title" className="discoverSectionTitle">
            Cheap Pint Leaderboard
          </h2>
          <p className="discoverSectionDek">
            Lowest listed pint prices, separate from the recently logged
            prices above. Open a pub to see how fresh its number is.
          </p>
          {status === "idle" ? (
            <p className="discoverEmpty" role="status">
              The cheap pint table loads when you reach the rankings.
            </p>
          ) : status === "loading" ? (
            <p className="discoverEmpty" role="status">
              Counting the cheapest pints…
            </p>
          ) : status === "error" ? (
            <p className="discoverEmpty" role="status">
              Couldn&rsquo;t load the leaderboard just now.{" "}
              <Link href={openMapHref}>Open the map</Link>{" "}
              instead.
            </p>
          ) : (
            <LeaderboardTable entries={entries} />
          )}
        </section>
      ) : null}

      {status === "error" || status === "idle" || status === "loading" || thenVsNow.length > 0 ? (
        <section className="discoverSection" aria-labelledby="thenVsNow-title">
          <h2 id="thenVsNow-title" className="discoverSectionTitle">
            Then vs Now
          </h2>
          <p className="discoverSectionDek">
            Latest community-reported pint against the earlier price on
            record. The biggest movers first.
          </p>
          <p className="discoverSectionNote">
            Then is the price on record. Now is the latest one someone logged.
          </p>
          {status === "idle" ? (
            <p className="discoverEmpty" role="status">
              Price comparisons load when you reach the rankings.
            </p>
          ) : status === "loading" ? (
            <p className="discoverEmpty" role="status">
              Comparing earlier prices…
            </p>
          ) : status === "error" ? (
            <p className="discoverEmpty" role="status">
              Couldn&rsquo;t load price comparisons just now.{" "}
              <Link href={openMapHref}>Open the map</Link>{" "}
              instead.
            </p>
          ) : (
            <div className="tvnGrid">
              {thenVsNow.map((item) => (
                <ThenVsNowCard key={item.venueId} item={item} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="discoverSection" aria-labelledby="editorial-title">
        <h2 id="editorial-title" className="discoverSectionTitle">
          Ways to drink through the city
        </h2>
        <div className="editorialGrid">
          {editorial.map((card) => (
            <EditorialCard key={card.id} {...card} />
          ))}
        </div>
      </section>

      {heritageCards.length > 0 && (
        <section className="discoverSection" aria-labelledby="heritage-title">
          <h2 id="heritage-title" className="discoverSectionTitle">
            Historic London
          </h2>
          <p className="discoverSectionDek">
            Themed heritage routes built from the pubs&rsquo; cited histories.
            Oldest first, the riverside taverns, and the highly listed classics.
          </p>
          <p className="discoverSectionNote">
            Cited from Wikipedia.
          </p>
          <div className="editorialGrid">
            {heritageCards.map((card) => (
              <EditorialCard key={card.id} {...card} />
            ))}
          </div>
        </section>
      )}
    </Root>
  );
}

export default function DiscoverPageClient(props: DiscoverPageClientProps) {
  return <DiscoverBody {...props} />;
}
