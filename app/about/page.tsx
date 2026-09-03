import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { loadAboutStats, type AboutStats } from "@/lib/aboutStats";
import { buildLeagueTable, indexSummary } from "@/lib/pintIndex";
import { loadPublicPintIndexSnapshot } from "@/lib/publicPintIndexSnapshot.server";
import { CONTACT_EMAIL } from "@/lib/siteContact";

import "./about.css";

// /about — the founder story surface (PRD_SEARCH_GROWTH S4.5; Wave S1 of
// docs/plans/FIRST_PRINCIPLES_OUTINGS.md). One page that triples as: (1) the
// "why PUBMAXX exists" narrative, (2) a press bio + press kit, and (3) an
// investor link surface. Server component, zero client JS — it renders once
// from the bundled datasets and the site's design tokens.
//
// Provenance rule (CONTEXT.md / PRODUCT.md): every number in the traction band
// is computed at request time from the same data the map reads (lib/aboutStats)
// — no invented users, revenue, or growth metrics. The prose sticks to public
// product decisions and founder-led wording already on this page; no invented
// biography, co-founder names, or fake counts (docs/VOICE.md).

const PAGE_TITLE = "Our story: why PUBMAXX exists";
const PAGE_DESCRIPTION =
  "A pint in London can cost eight quid. PUBMAXX puts listed prices on one map for nights out, coffee, food, and sober hangs. We name and link publishers when recorded, and say when none is recorded. Free, and nobody pays to rank.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    siteName: metadataSiteName(),
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PUBMAXXING: every pint has a story",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    images: ["/og.png"],
  },
};

// One address for the whole site (lib/siteContact.ts) — /about, /privacy and
// /terms must never quote different inboxes, and only this one is monitored.

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function fmtGbp(n: number | null): string {
  if (n === null) return "–";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type Stat = { value: string; label: string; note: string };

function tractionStats(s: AboutStats): Stat[] {
  return [
    {
      value: fmtInt(s.pubsTracked),
      label: "pubs tracked",
      note: "each one carrying a price on record",
    },
    {
      value: fmtInt(s.pintPricesObserved),
      label: "pint prices logged",
      note: "readings with their source status shown",
    },
    {
      value: fmtInt(s.historicPubsCited),
      label: "historic pubs cited",
      note: "one sourced fact each",
    },
    {
      value: fmtInt(s.citiesCovered),
      label: "UK cities live",
      note: "London first, more to browse",
    },
  ];
}

export default async function AboutPage() {
  const [stats, pintIndexSnapshot] = await Promise.all([
    loadAboutStats(),
    loadPublicPintIndexSnapshot(),
  ]);
  const pintIndexRows = pintIndexSnapshot
    ? buildLeagueTable(pintIndexSnapshot)
    : [];
  const pintIndexSummary = indexSummary(pintIndexRows);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // AboutPage + Organization JSON-LD. NOTE (see agent report): components/seo/
  // JsonLd.tsx from PR #274 is NOT on this base branch, so this is inlined here
  // following the layout.tsx nonce-aware CSP pattern. If #274 lands first,
  // migrate this block to <JsonLd> and drop the inline script to avoid two
  // Organization nodes on the site.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    isPartOf: {
      "@type": "WebSite",
      name: "PUBMAXXING",
      url: "https://pubmaxxing.com",
    },
    about: {
      "@type": "Organization",
      name: "PUBMAXX",
      alternateName: "PUBMAXXING",
      url: "https://pubmaxxing.com",
      logo: "https://pubmaxxing.com/icon-512.png",
      description:
        "Listed prices with explicit source status for UK pubs, mapped for nights out, daytime hangs, food, coffee, and alcohol-free rounds. A free outing planner that never lets anyone pay to rank.",
      email: CONTACT_EMAIL,
      founder: {
        "@type": "Person",
        name: "Karan Manoharan",
        url: "https://x.com/karansznx",
      },
      sameAs: ["https://x.com/karansznx"],
    },
  };

  const cheapest = fmtGbp(stats.cheapestPint);
  const average = fmtGbp(stats.averagePint);
  const dearest = fmtGbp(stats.dearestPint);

  return (
    <main id="main" className="aboutPage">
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON-LD is inert data, not executable script; serialised once on the
        // server. XSS-safe: JSON.stringify of a fixed object, no user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Wordmark + way out: same SiteNav shell as /pint-index and /plan. */}
      <SiteNav />

      {/* ── Brand-first story lede (one composition, not a card grid) ── */}
      <header className="aboutHero">
        <p className="aboutBrand">PUBMAXX</p>
        <span className="aboutBrassRule" aria-hidden="true" />
        <h1 className="aboutTitle">
          A pint in London can cost eight quid. Nobody tells you where it
          doesn&rsquo;t.
        </h1>
        <p className="aboutLede">
          You finish work, you want somewhere nearby that will not mug you:
          a good pint, a coffee and a seat, food before the last train, or a
          quiet room with mates who are not drinking. So you open Google Maps,
          then another map, then reviews, then you&rsquo;re asking ChatGPT, and
          an hour later you&rsquo;re back at the same place as last time. We
          built PUBMAXX so you don&rsquo;t have to do that. One map. Real
          prices with honest source status. The outing in one place.
        </p>
      </header>

      <section className="aboutSection" aria-labelledby="why">
        <h2 id="why" className="aboutH2">Why we built it</h2>
        <p className="aboutBody">
          Planning a night out had quietly turned into admin. The cheap pint is
          on one app. The walk is on another. Whether the place is any good is
          on a third. And the price, the thing that actually decides where you
          go, is nowhere at all.
        </p>
        <p className="aboutBody">
          So most nights you don&rsquo;t plan. You give up and end up where you
          always end up. Same for a daytime Spoons with a laptop, a soft-drink
          round, or a catch-up that never needed a lager. A seat shouldn&rsquo;t
          cost a day&rsquo;s lunch, and finding the one that doesn&rsquo;t
          shouldn&rsquo;t cost your whole evening.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="did">
        <h2 id="did" className="aboutH2">What we did about it</h2>
        <p className="aboutBody">
          We put real prices on the map, starting in London. When a price record
          names a publisher, we name and link it. When no publisher is recorded,
          the price says so. The ones logged by drinkers carry the day they were
          seen. Tap a pub and you see what a drink costs before you set off, not
          after you&rsquo;ve handed over a note.
        </p>
        <p className="aboutBody">
          A first report can mark a pin straight away. Pin colour, list rows,
          and cheapest buckets wait for a second independent drinker. Speed is
          nice. A figure that survives a challenge is the product.
        </p>
        <p className="aboutBody">
          We kept the stories too. Most of these pubs have been pouring for a
          century or two, and the good ones earned their walk. So we cite the
          heritage, and we never make it up.
        </p>
        <p className="aboutBody">
          And we made it one link for the crew. You plan the outing, you send
          it, everyone lands in the same place walking the same route. No
          group-chat archaeology at half six.
        </p>
        <p className="aboutBody">
          Nobody pays to rank. Not ever. There&rsquo;s a wall in the code
          between anyone&rsquo;s money and the prices you see. A sponsored thing
          says so and sits in its own slot. The order of pubs on your map is
          never for sale.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="fights">
        <h2 id="fights" className="aboutH2">What we refused to ship</h2>
        <ul className="aboutEthos">
          <li>
            <strong>Every report as map truth.</strong> An uncorroborated price
            can show on the pub&rsquo;s own sheet. It does not paint the pin
            until a second independent drinker agrees inside the age window.
          </li>
          <li>
            <strong>Fake Wetherspoons prices.</strong> Their public web menus do
            not yield per-pub drink prices today, so we refuse to invent them.
            Identity and honest gaps beat a made-up board.
          </li>
          <li>
            <strong>UK spray before London depth.</strong> We ship London first
            with priced pubs you can plan around. A separate OpenStreetMap layer
            shows more pubs across the country without pretending they carry the
            same price truth.
          </li>
          <li>
            <strong>Paid placement in the price order.</strong> Sponsored slots
            stay labelled and separate. Rank is not a product we sell.
          </li>
        </ul>
      </section>

      <section className="aboutSection" aria-labelledby="who">
        <h2 id="who" className="aboutH2">Who it&rsquo;s for</h2>
        <p className="aboutBody">
          Everyone who actually goes out. The after-work crowd who want a cheap
          round before the last train. The quiet-pint person who just wants a
          good one and a seat by the window. The birthday mob who need somewhere
          that&rsquo;ll take twelve of them on a Friday.
        </p>
        <p className="aboutBody">
          Also the daytime jobs: coffee and a laptop at a Spoons, food then a
          soft drink, an alcohol-free hang, a chill afternoon that never needed
          a crawl. Soft drink and alcohol-free prices share the same trust
          rules as beer. Coffee joins that honesty once someone logs it. Food
          anchors stay honest about their source and never masquerade as a pint
          on the pin.
        </p>
        <p className="aboutBody">
          We&rsquo;re building this for people who notice an eight-quid lager,
          and for people who open a pub when they are not drinking at all.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="team">
        <h2 id="team" className="aboutH2">Who builds it</h2>
        <p className="aboutBody">
          PUBMAXX is founder-led by{" "}
          <a
            href="https://x.com/karansznx"
            target="_blank"
            rel="noreferrer"
            className="aboutLink"
          >
            Karan Manoharan
          </a>
          . We argue about corroboration versus speed, London depth versus a
          thinner national map, and what a price is allowed to claim. Those
          fights land in the product, not in a brand deck.
        </p>
        {/* Founder note (FIRST_PRINCIPLES_OUTINGS follow-up): the builder's own
            voice, in first person. Provenance rule holds here harder than
            anywhere: the note carries no dates, schools, jobs, or any personal
            fact this site cannot stand behind - only the why, the mission, and
            the honesty rule the rest of the page already proves. */}
        <figure className="aboutFounderNote">
          <blockquote className="aboutFounderQuote">
            <p className="aboutBody">
              I built PUBMAXX because pint prices became hard to know.
            </p>
            <p className="aboutBody">
              If PUBMAXX shows you a figure, it tells you its source status: a
              named publisher where one is recorded, an honest note when a
              publisher is not recorded, or a drinker who logged it on a stated
              day. If nobody has logged a figure, it says so.
            </p>
            <p className="aboutBody">
              I want PUBMAXX to be the best way in the world to decide which pub
              to walk into.
            </p>
          </blockquote>
          <figcaption className="aboutFounderSig">
            Karan Manoharan, founder of PUBMAXX
          </figcaption>
        </figure>
      </section>

      <section className="aboutSection" aria-labelledby="ethos">
        <h2 id="ethos" className="aboutH2">What we stand for</h2>
        <ul className="aboutEthos">
          <li>
            <strong>Prices with honest source status.</strong> Listed prices
            name and link their publisher when recorded, and say when no
            publisher is recorded. A missing publisher stays missing rather
            than being guessed. Cited pub stories link to their references.
          </li>
          <li>
            <strong>Good nights count people and memories.</strong> Rewards and
            rankings do not count how much you drink.
          </li>
          <li>
            <strong>Your nights are yours.</strong> Nothing&rsquo;s public unless
            you choose to share it, and you can browse the whole thing without an
            account.
          </li>
          <li>
            <strong>Free to browse.</strong> Nobody pays to rank, and sponsored
            items sit in their own labelled slots.
          </li>
        </ul>
      </section>

      {/* ── Traction / numbers (real, computed at build) ───────── */}
      <section className="aboutSection aboutTraction" aria-labelledby="traction">
        <h2 id="traction" className="aboutH2">By the numbers</h2>
        <p className="aboutBody aboutTractionIntro">
          Every number here is counted from the same public data the app runs
          on. No vanity metrics, no invented users. If it&rsquo;s on this page,
          it&rsquo;s real.
        </p>
        <dl className="aboutStatGrid">
          {tractionStats(stats).map((stat) => (
            <div key={stat.label} className="aboutStat">
              <dt className="aboutStatValue">{stat.value}</dt>
              <dd className="aboutStatBody">
                <span className="aboutStatLabel">{stat.label}</span>
                <span className="aboutStatNote">{stat.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="aboutPriceLine">
          Across <strong>{fmtInt(stats.boroughsCovered)}</strong> London
          boroughs and neighbourhoods, the cheapest pint we&rsquo;ve logged is{" "}
          <span className="aboutPriceStamp">{cheapest}</span>. The dearest is{" "}
          <span className="aboutPriceStamp">{dearest}</span>, and someone is
          paying it. The average sits at{" "}
          <span className="aboutPriceStamp">{average}</span>.
        </p>
      </section>

      {/* ── Press kit ──────────────────────────────────────────── */}
      <section className="aboutSection aboutPress" aria-labelledby="press">
        <h2 id="press" className="aboutH2">Press kit</h2>
        <dl className="aboutPressGrid">
          <div className="aboutPressRow">
            <dt>Name</dt>
            <dd>PUBMAXX. The app is PUBMAXXING.</dd>
          </div>
          <div className="aboutPressRow">
            <dt>One line</dt>
            <dd>
              Listed prices with explicit source status, one map for nights out
              and daytime hangs, and a plan you can send. Free, and nobody pays
              to rank.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Positioning</dt>
            <dd>
              London runs on its pubs. This is the app that helps you decide
              where to go for a night out, a coffee, food, or a quiet afternoon,
              what it costs, and who you&rsquo;re meeting.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Contact</dt>
            <dd>
              <a href={`mailto:${CONTACT_EMAIL}`} className="aboutLink">
                {CONTACT_EMAIL}
              </a>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Founder</dt>
            <dd>
              Karan Manoharan
              {" · "}
              <a
                href="https://x.com/karansznx"
                target="_blank"
                rel="noreferrer"
                className="aboutLink"
              >
                X
              </a>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Also see</dt>
            <dd>
              <Link href="/pint-index" className="aboutLink">
                The Pint Index
              </Link>
              {" · "}
              <Link href="/historic" className="aboutLink">
                Historic pubs
              </Link>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Logo</dt>
            <dd className="aboutLogoLinks">
              <a href="/icon-512.png" download className="aboutLink">
                PNG (512px)
              </a>
              {" · "}
              <a href="/favicon.svg" download className="aboutLink">
                SVG mark
              </a>
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Story hooks (press angle) ──────────────────────────── */}
      <section className="aboutSection aboutPress" aria-labelledby="press-hooks">
        <h2 id="press-hooks" className="aboutH2">Story hooks</h2>
        <p className="aboutBody">
          London runs on its pubs. This is the app that helps you decide where
          to go. If you&rsquo;re writing about the cost of a night out, the Pint
          Index is your angle. If you&rsquo;re writing about daytime pubs,
          coffee, food, or alcohol-free rounds, the same honesty rules apply.
        </p>
        <ul className="aboutEthos">
          {pintIndexRows.length > 0 && pintIndexSnapshot ? (
            <>
              <li>
                <strong>London&rsquo;s pint price league table.</strong> The
                Pint Index currently ranks{" "}
                <strong>{fmtInt(pintIndexSummary.boroughCount)}</strong>{" "}
                boroughs from{" "}
                <strong>{fmtInt(pintIndexSnapshot.observations.length)}</strong>{" "}
                dated prices across{" "}
                <strong>{fmtInt(pintIndexSummary.pubCount)}</strong> pubs.
              </li>
              <li>
                <strong>A price series, not a one-off headline.</strong> Only
                prices with a public source and date enter the Index. Closed
                months keep their own frozen edition.
              </li>
            </>
          ) : (
            <li>
              <strong>No borough league yet.</strong> The public Pint Index has
              no dated prices with a public source to rank yet. Older map-only
              prices stay separate from the league.
            </li>
          )}
        </ul>
        <p className="aboutBody">
          <Link href="/pint-index" className="aboutLink">
            {pintIndexRows.length > 0
              ? "See the league table"
              : "See the Index status"}
          </Link>
        </p>
      </section>

      <section className="aboutSection aboutCta" aria-labelledby="cta">
        <h2 id="cta" className="aboutH2">Come pubmaxxing</h2>
        <p className="aboutBody">
          Press, investors, and anyone who just wants a cheaper pint or a
          quieter afternoon: you&rsquo;re all welcome. Start on the map, or say
          hello.
        </p>
        <div className="aboutCtaRow">
          <Link href="/map" className="aboutBtn aboutBtnPrimary">
            Open the map
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="aboutBtn aboutBtnGhost">
            Get in touch
          </a>
        </div>
      </section>

      <section className="aboutSection aboutCredits" aria-labelledby="credits">
        <h2 id="credits" className="aboutH2">Data &amp; sources</h2>
        <ul className="aboutSourceList">
          <li>
            Listed-building status comes from Historic England&apos;s National
            Heritage List for England (NHLE), &copy; Historic England, licensed
            under the{" "}
            <a
              href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Government Licence v3.0
            </a>
            . Each listed fact links to its official list entry.
          </li>
          <li>Heritage narrative is cited from Wikipedia and Wikidata.</li>
          <li>Mapping data is &copy; OpenStreetMap contributors.</li>
        </ul>
      </section>
    </main>
  );
}
