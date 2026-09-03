import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import CrawlStoryCopyButton from "@/components/crawl/CrawlStoryCopyButton";
import CrawlStoryOwnerControls from "@/components/crawl/CrawlStoryOwnerControls";
import ShareBar from "@/components/share/ShareBar";
import { computeChaosScore } from "@/lib/chaosScore";
import { getCrawlStoryBySlug, type DurableStory } from "@/lib/crawlStoryStore";
import { buildCrawlShareText } from "@/lib/shareArtifacts";
import { formatGbp } from "@/lib/formatGbp";

import "./story.css";

// Durable Crawl Story permalink: /crawls/[slug]. A SERVER component — it reads
// the story straight from the store (pub names resolved server-side, PRD §9),
// renders a collectible "crawl poster", and never ships venueIndex to the
// client. An unknown OR draft slug resolves to null (a draft is private — there
// is no auth yet, so nobody can view it) → a friendly empty state, not a 500.
//
// Next 16 dynamic route params are async — `params` is a Promise we await.

type PageProps = { params: Promise<{ slug: string }> };

// Plan the crawl back onto the map from its stop venue ids — same share-URL
// format seedCrawlState reads (mode=build&pubs=id1,id2). Stops missing a venue
// id just aren't planned back.
function planCrawlHref(story: DurableStory): string {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

// Chaos Score (issue #30, PRD "The Spill" § The Lock-In) — optional, playful,
// computed from signals this durable story already carries: stop count, price
// spread across priced stops, and the story's own vibe tags. A durable story
// has no per-stop timestamp or borough field yet, so lateness/borough-hops
// stay at their "no signal" default (0) here rather than guessing.
function chaosScoreFor(story: DurableStory) {
  const prices = story.stops.map((stop) => stop.priceGbp ?? null);
  return computeChaosScore({
    stopCount: story.stops.length,
    prices,
    vibeTags: story.vibeTags,
  });
}

// Build a /api/chaos-card URL carrying the already-computed score/grade/line so
// the OG image never has to recompute (and can never drift from what's shown
// on the page).
function chaosCardHref(story: DurableStory, chaos: ReturnType<typeof computeChaosScore>): string {
  const params = new URLSearchParams();
  params.set("title", story.title);
  params.set("score", String(chaos.score));
  params.set("grade", chaos.grade);
  params.set("line", chaos.oneLiner);
  return `/api/chaos-card?${params.toString()}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getCrawlStoryBySlug(slug);
  // A missing OR draft story (getCrawlStoryBySlug already withholds drafts) gets
  // generic, non-indexed metadata — an unpublished crawl must never leak a title
  // or a share card.
  if (!story) {
    return {
      title: "Crawl Story",
      robots: { index: false, follow: false },
    };
  }

  const title = story.title;
  const topTag = story.vibeTags[0];
  const cardParams = new URLSearchParams();
  cardParams.set("title", title);
  cardParams.set("stops", String(story.stops.length));
  if (story.totalGbp > 0) cardParams.set("total", story.totalGbp.toFixed(2));
  if (topTag) cardParams.set("tag", topTag);
  const cardUrl = `/api/crawl-card?${cardParams.toString()}`;

  const description =
    story.summary ||
    `A London pub crawl. ${story.stops.length} stop${story.stops.length === 1 ? "" : "s"}${
      story.totalGbp > 0 ? `, ${formatGbp(story.totalGbp)} a round` : ""
    }.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: cardUrl, width: 1200, height: 630, alt: `${title}, a London crawl` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [cardUrl],
    },
  };
}

export default async function CrawlStoryPage({ params }: PageProps) {
  const { slug } = await params;
  const story = await getCrawlStoryBySlug(slug);
  if (!story) notFound();

  const total = story.totalGbp;
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;
  const stopCount = story.stops.length;

  // Share lockup — a nostalgic one-liner so the crawl travels into a group chat.
  const shareText = buildCrawlShareText({
    title: story.title,
    stopCount,
    totalGbp: total,
  });

  // Chaos Score + meme export (issue #30) — optional, playful, computed once
  // here so the on-page badge and the shared card always agree.
  const chaos = chaosScoreFor(story);
  const chaosCard = chaosCardHref(story, chaos);

  return (
    <main id="main" className="storyShell">
      <nav className="storyNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/social?tab=discover">Explore</Link>
      </nav>

      <article className="storyPoster">
        <header className="storyHead">
          <p className="storyEyebrow">A London crawl</p>
          <h1 className="storyTitle">{story.title}</h1>
          {/* Author attribution (story 35). Links to the author's public profile;
              an anonymous story (no author_handle) shows nothing. */}
          {story.authorHandle ? (
            <p className="storyAuthor">
              by{" "}
              <Link href={`/u/${encodeURIComponent(story.authorHandle)}`} className="storyAuthorLink">
                @{story.authorHandle}
              </Link>
            </p>
          ) : null}
          {story.summary ? <p className="storyCaption">{story.summary}</p> : null}
          {story.vibeTags.length ? (
            <ul className="storyTags" aria-label="Crawl vibe tags">
              {story.vibeTags.map((tag) => (
                <li key={tag} className="storyTag">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <ol className="storyStops">
          {story.stops.map((stop, index) => (
            <li key={`${stop.venueId}-${index}`} className="storyStop">
              <span className="storyStopNumber" aria-hidden="true">
                {index + 1}
              </span>
              <div className="storyStopBody">
                <a className="storyStopName" href={stop.venueMapUrl}>
                  {stop.venueName}
                </a>
                {stop.note ? <p className="storyStopNote">{stop.note}</p> : null}
              </div>
              <span className="storyStopPrice">
                {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "–"}
              </span>
            </li>
          ))}
        </ol>

        <div className="storyReceipt" role="group" aria-label="Crawl total">
          <span>
            Round total
            <small>
              {pricedStops} of {stopCount} stop{stopCount === 1 ? "" : "s"} priced
            </small>
          </span>
          <strong>{formatGbp(total)}</strong>
        </div>

        {/* Chaos Score (issue #30) — optional and playful; a crawl with zero
            stops (shouldn't happen, but never trust it) just shows "Quiet". */}
        <div className="storyChaos" role="group" aria-label="Chaos Score">
          <span className="storyChaosScore">
            {chaos.score}
            <small>/100</small>
          </span>
          <span className="storyChaosBody">
            <strong className="storyChaosGrade">{chaos.grade}</strong>
            <span className="storyChaosLine">{chaos.oneLiner}</span>
          </span>
        </div>

        <div className="storyActions">
          <Link href={planCrawlHref(story)} className="storyPrimaryBtn">
            Plan this crawl
          </Link>
          {/* Meme export (issue #30) — a branded OG-style card of the score,
              opened in a new tab so it can be saved/shared directly. */}
          <a
            href={chaosCard}
            className="storySecondaryBtn"
            target="_blank"
            rel="noreferrer"
          >
            Share the chaos
          </a>
          <CrawlStoryCopyButton />
        </div>

        {/* Author-only edit/delete (story 35). Renders nothing for non-authors. */}
        {story.authorHandle ? (
          <CrawlStoryOwnerControls slug={slug} authorHandle={story.authorHandle} />
        ) : null}

        {/* Share strip — the crawl spreads across X, WhatsApp, and group chats. */}
        <div className="storyShare">
          <ShareBar url={`/crawls/${slug}`} title={story.title} text={shareText} />
        </div>

        <p className="storyFootnote">Pubs, prices and the route between them.</p>
      </article>

    </main>
  );
}
