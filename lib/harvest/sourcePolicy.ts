// Which London sources the harvest may read, and the evidence for each answer.
//
// A SKIP IS A FINDING, NOT A GAP. Every source the harvest knows about is in
// this table whether it may be read or not, each carrying the rule that decided
// it and the day that rule was checked. The run report prints the skips beside
// the counts, so "we harvested nothing from Mitchells & Butlers" reads as a
// recorded decision with a reason rather than as coverage nobody noticed was
// missing. A source that is not in this table is not harvested at all: the
// fetchers take their URLs from here, never from a caller.
//
// THE BAR IS PERMISSION, NOT REACHABILITY. `robots-unreadable` is a REFUSAL:
// several Mitchells & Butlers brands answer their own robots.txt with a
// challenge page, so no permission can be established, and a page we cannot ask
// about is a page we do not take. The same goes for a site whose robots.txt
// admits ordinary crawlers but names the headless-renderer class Firecrawl
// belongs to in a Disallow - the narrower rule is the one that binds.
//
// FIRST PARTY IS THE DEFAULT AND A LISTINGS SITE IS THE EXCEPTION, which is why
// every ticketing aggregator here is refused. That is continuous with
// docs/EVENT_SOURCES_RESEARCH_2026-07-18.md, which chose official APIs over
// scraping aggregators for the same reason. A non-first-party source that IS
// allowed states its own exception in `nonFirstPartyException`, naming what it
// may take, so the permission is as narrow as the decision that granted it.

/** Why a source is not read this run. */
export const HARVEST_SKIP_REASONS = [
  "robots-disallowed",
  "robots-unreadable",
  "terms-forbid-commercial-use",
  "no-firecrawl-key",
  "budget-exhausted",
  "not-scheduled-this-run",
] as const;
export type HarvestSkipReason = (typeof HARVEST_SKIP_REASONS)[number];

export type HarvestSourceKind = "chain-deals" | "venue-events" | "pub-facts";

export type HarvestSourceAccess =
  | { allowed: true; evidence: string; checkedOn: string }
  | { allowed: false; reason: HarvestSkipReason; evidence: string; checkedOn: string };

export type HarvestSource = {
  id: string;
  /** Provenance label carried by every row this source produces. */
  label: string;
  /** Provenance URL, and the page the fetcher actually reads. */
  url: string;
  kind: HarvestSourceKind;
  /** True when the publisher owns the thing published (an operator, not a listings site). */
  firstParty: boolean;
  access: HarvestSourceAccess;
  /**
   * Why a publisher that does not own what it publishes is nonetheless read.
   * FIRST PARTY IS THE DEFAULT, so an allowed non-first-party source states its
   * own exception here - what it may take, and what it may not - or the fence
   * refuses it.
   */
  nonFirstPartyException?: string;
  /**
   * Seconds a polite reader waits between requests to this host, when the host
   * publishes a Crawl-delay. Absent means the host asked for none.
   */
  crawlDelaySeconds?: number;
  /** What this source is expected to yield, and what it plainly will not. */
  notes: string;
};

const CHECKED_ON = "2026-08-09";

export const HARVEST_SOURCES: readonly HarvestSource[] = [
  // --- chain deals: first-party operator offers pages ----------------------
  {
    id: "wetherspoon-food-drink",
    label: "J D Wetherspoon - Food & drink",
    url: "https://www.jdwetherspoon.com/food-drink/",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt: `User-agent: *` with an empty `Disallow:` (allow all), plus `Crawl-delay: 10`.",
      checkedOn: CHECKED_ON,
    },
    crawlDelaySeconds: 10,
    notes:
      "Publishes its weekly club days under a `## Club deals` heading, each stating its own day and window. This is the page the hand-seeded club table was transcribed from; harvesting it means a club that changes is picked up rather than re-typed.",
  },
  {
    id: "greene-king-deals",
    label: "Greene King - Deals",
    url: "https://www.greeneking.co.uk/deals",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt disallows only infrastructure paths (/bin/, /media/, /sitecore/, booking query strings); /deals is not among them.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "States day-scoped offers, but most name a SISTER BRAND (Flaming Grill, Hungry Horse, Farmhouse Inns) rather than a Greene King pub. A row may only reach the venues of the brand its own copy names, so a Greene King pub earns nothing from a Hungry Horse deal.",
  },
  {
    id: "fullers-whats-on",
    label: "Fuller's - What's on",
    url: "https://www.fullers.co.uk/event-finder",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt disallows /sitecore/, /homepage/ and three internal paths only.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: the event finder renders its results in the browser, so the served document lists no event, and the programme pages behind it (for example Laughs On Tap) give a season rather than a date. Expect zero rows until Fuller's publishes dates in the document.",
  },
  {
    id: "youngs-offers",
    label: "Young's - On Tap",
    url: "https://www.youngs.co.uk/on-tap-app",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt: `User-agent: *` with an empty `Disallow:` (allow all).",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: Young's publishes app rewards rather than a recurring deal day, and names no day or window. Expect zero rows; its per-pub pages are useful for stated opening hours instead.",
  },
  {
    id: "mitchells-butlers-brands",
    label: "Mitchells & Butlers pub brands",
    url: "https://www.mbplc.com/",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: false,
      reason: "robots-unreadable",
      evidence:
        "Nicholson's, All Bar One, O'Neill's, Castle, Ember Inns, Sizzling Pubs, Toby Carvery and Browns all answer /robots.txt with a challenge page rather than a rules file, so no permission can be read. The two estate sites that do answer (harvester.co.uk, millerandcarter.co.uk) carry `User-agent: CloudflareBrowserRenderingCrawler / Disallow: /`, which is the headless-renderer class this harvest uses.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Refused on permission, not on reachability. Revisit if the estate publishes a readable robots.txt that admits a rendering crawler, or if Mitchells & Butlers offers a feed.",
  },

  // --- events: the one permitted listings reader, then the refused ---------
  {
    id: "fullers-event-finder-events",
    label: "Fuller's",
    url: "https://www.fullers.co.uk/event-finder",
    kind: "venue-events",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt disallows /sitecore/, /homepage/ and three internal paths only.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "The operator's own event finder. Checked 2026-08-09: results render in the browser, so a markdown read may yield zero dated rows until Fuller's publishes dates in the document. Context.dev events lane reads this page; the chain-deals lane reads the same URL separately.",
  },
  {
    id: "common-social-posts",
    label: "common",
    url: "https://www.common-social.com/sitemap.xml",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: true,
      evidence:
        "robots.txt: `User-agent: *` with no Disallow covering /post/, and it names the sitemap itself. Checked 2026-08-16. No commercial-use bar is stated, and the reader takes no page the sitemap does not list.",
      checkedOn: "2026-08-16",
    },
    nonFirstPartyException:
      "Captain 2026-08-16, and the exception is narrow: FACTS ONLY plus a link out. Place and date come from the og:description prefix, the description text itself is never stored or rendered, and every card links back to the post. Nothing here is a price lane.",
    crawlDelaySeconds: 1,
    notes:
      "Read by scripts/whatson/commonRefresh.mjs, which is bound to this entry's own URL and delay. FACTS ONLY plus a link out: it reads og:title and the og:description PREFIX (`<place> · <date>`) and nothing else, so the description text and the names inside it are never stored or rendered. One request per second, a UA naming PUBMAXX and the public contact, and a per-run fetch cap. Common publishes no clock time, so a row states a date and says so.",
  },
  {
    id: "skiddle-listings",
    label: "Skiddle",
    url: "https://www.skiddle.com/whats-on/London/",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "terms-forbid-commercial-use",
      evidence:
        "Skiddle's own terms make the events data non-commercial without written approval from dev@skiddle.com; PUBMAXX is commercial. robots.txt would permit the listing path, but the narrower rule binds. Recorded the same way in docs/EVENT_SOURCES_RESEARCH_2026-07-18.md.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "The best pub-scale London coverage of the aggregators, and the one worth asking for. Written approval plus SKIDDLE_API_KEY switches on the official API path in scripts/whatson/eventsRefresh.mjs; it does not switch on scraping.",
  },
  {
    id: "dice-listings",
    label: "DICE",
    url: "https://dice.fm/browse/london",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "robots-disallowed",
      evidence:
        "robots.txt names `User-agent: CloudflareBrowserRenderingCrawler / Disallow: /` alongside the AI crawlers, and sets `Content-Signal: ai-train=no,use=reference`. The generic `Allow: /` does not survive the narrower rule.",
      checkedOn: CHECKED_ON,
    },
    notes: "No public discovery API either, so there is no permitted path to this inventory today.",
  },
  {
    id: "wegottickets-listings",
    label: "WeGotTickets",
    url: "https://www.wegottickets.com/searchresults/all/London",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "robots-disallowed",
      evidence:
        "robots.txt permits the search page but disallows /af/, which is where every event on it links. An event we may not open is an event we may not date, price or attribute.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: the London search page is a national promo shelf in any case (its cards were North Shields and Northampton events), so the permitted half carries no London listing worth taking.",
  },
];

const BY_ID = new Map(HARVEST_SOURCES.map((source) => [source.id, source]));

export function harvestSource(id: string): HarvestSource | undefined {
  return BY_ID.get(id);
}

export function isHarvestSourceAllowed(source: HarvestSource): boolean {
  return source.access.allowed;
}

export function harvestSourcesOfKind(kind: HarvestSourceKind): HarvestSource[] {
  return HARVEST_SOURCES.filter((source) => source.kind === kind);
}

/** The sources of a kind this run may actually read. */
export function allowedHarvestSources(kind: HarvestSourceKind): HarvestSource[] {
  return harvestSourcesOfKind(kind).filter(isHarvestSourceAllowed);
}

/**
 * Allowed venue-events pages the Context.dev events lane may read.
 *
 * FIRST PARTY IS THE BAR, and it is the semantic property rather than a proxy
 * for it: an extract call hands a whole page to a model and takes back whatever
 * it says, so it cannot honour the narrow `nonFirstPartyException` an allowed
 * listings source carries ("facts only, from the og:description prefix" is a
 * promise no extraction keeps). A URL suffix stood in for this and would have
 * admitted the next allowed non-first-party page that did not happen to end
 * `.xml`.
 */
export function contextDevEventSources(): HarvestSource[] {
  return allowedHarvestSources("venue-events").filter((source) => source.firstParty);
}

/**
 * A venue's own site is first-party by definition, so it needs no table row -
 * but it still has to be a real http(s) origin we can attribute, and it may
 * never be one of the refused hosts wearing a venue's name.
 */
const REFUSED_HOSTS = new Set(
  HARVEST_SOURCES.filter((source) => !source.access.allowed).map((source) => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return source.url;
    }
  }),
);

export function isHarvestableOperatorUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !REFUSED_HOSTS.has(url.hostname.replace(/^www\./, ""));
}
