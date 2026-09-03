import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import PriceBadge from "@/components/PriceBadge";
import PubmaxxNightSeal from "@/components/brand/PubmaxxNightSeal";
import SiteNav from "@/components/nav/SiteNav";
import RecapShareButton from "@/components/plan/RecapShareButton";
import { getPublishedRecapSource } from "@/lib/nightMemoryStore";
import { PUBLIC_RECAP_PHOTO_TTL_SECONDS, signedNightMomentPhotoUrl } from "@/lib/nightMomentMedia";
import { pintDropsStore } from "@/lib/pintDropsStore";
import type { PintDrop } from "@/lib/pintDropShared";
import { getVenueDetail } from "@/lib/venueDetailIndex";
import { buildRecapShareText, composeRecapFromPublishedStory } from "@/lib/recapView";

import "../../plan/plan.css";
import "../../plan/[id]/recap/recap.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ storyId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storyId } = await params;
  if (!UUID.test(storyId)) return { title: "Recap · PUBMAXXING", robots: { index: false } };
  const src = await getPublishedRecapSource(storyId);
  if (!src) return { title: "Recap · PUBMAXXING", robots: { index: false } };
  const indexable = src.story.visibility === "public";
  return {
    title: `${src.story.title} · A night out · PUBMAXXING`,
    // Only fully public recaps are indexable; unlisted ones stay link-only.
    robots: { index: indexable, follow: indexable },
    openGraph: { title: src.story.title, type: "article", url: `/recap/${storyId}` },
    twitter: { card: "summary_large_image", title: src.story.title },
  };
}

/** Resolve the pint drops referenced by published pint moments, keyed by id. */
async function resolvePintDrops(venueIds: string[]): Promise<Map<string, PintDrop>> {
  const byId = new Map<string, PintDrop>();
  const unique = [...new Set(venueIds.filter(Boolean))];
  await Promise.all(
    unique.map(async (venueId) => {
      try {
        const drops = await pintDropsStore().listVisible(venueId);
        for (const drop of drops) {
          byId.set(drop.id, {
            id: drop.id,
            venueId: drop.venueId,
            handle: drop.handle,
            drink: drop.drink ?? "",
            priceGbp: drop.priceGbp ?? null,
            passedDownNote: drop.passedDownNote ?? "",
            era: drop.era ?? "",
            provenance: drop.provenance,
            status: drop.status,
            createdAt: drop.createdAt,
          });
        }
      } catch {
        // A pint-store outage never blocks the recap — pints simply omit.
      }
    }),
  );
  return byId;
}

export default async function PublicRecapPage({ params }: Props) {
  const { storyId } = await params;
  if (!UUID.test(storyId)) notFound();

  // The ONE privacy choke point: published, non-private, published-moment-gated.
  const src = await getPublishedRecapSource(storyId);
  if (!src) notFound();

  // Venue names for every venue referenced by a published moment.
  const venueIds = [...new Set(src.moments.map((m) => m.venueId).filter((v): v is string => Boolean(v)))];
  const venueNames = new Map<string, string>();
  await Promise.all(
    venueIds.map(async (venueId) => {
      const venue = await getVenueDetail(venueId);
      if (venue?.name) venueNames.set(venueId, venue.name);
    }),
  );

  const pintVenueIds = src.moments.filter((m) => m.kind === "pint_drop" && m.venueId).map((m) => m.venueId as string);
  const pintDropsById = await resolvePintDrops(pintVenueIds);

  const view = composeRecapFromPublishedStory({ story: src.story, moments: src.moments, pintDropsById, venueNames });
  if (!view) notFound();

  // Resolve approved photo URLs server-side (signed, short-lived). Only the
  // published + consent-approved photos ever reach this map.
  const photoUrls = new Map<string, string>();
  await Promise.all(
    view.photos.map(async (photo) => {
      // Short TTL: signed URLs can't be revoked, so a withdrawn consent must not
      // stay fetchable for an hour. The page re-signs on every render.
      const url = await signedNightMomentPhotoUrl(photo.mediaObjectKey, PUBLIC_RECAP_PHOTO_TTL_SECONDS);
      if (url) photoUrls.set(photo.id, url);
    }),
  );

  const shareText = buildRecapShareText({
    title: view.title,
    stopCount: view.stats.stopCount,
    totalGbp: view.stats.totalGbp,
  });
  let section = 0;
  const step = () => ({ ["--recap-step" as string]: String(section++) });

  return (
    <main id="main" className="recapPage">
      <SiteNav />

      <header className="recapHero" style={step()}>
        {/* A completed night mints its seal — struck on first reveal. */}
        <PubmaxxNightSeal className="recapHero__seal" size={64} title="Night sealed" />
        <p className="type-meta recapHero__eyebrow">A night out</p>
        <h1 className="recapHero__title type-section-title">{view.title}</h1>
        <div className="recapHero__stats" aria-label="Night at a glance">
          <span className="recapStat">
            <b>{view.stats.stopCount}</b> {view.stats.stopCount === 1 ? "stop" : "stops"}
          </span>
          {view.stats.pintCount > 0 ? (
            <span className="recapStat">
              <b>{view.stats.pintCount}</b> {view.stats.pintCount === 1 ? "pint" : "pints"}
            </span>
          ) : null}
          {view.stats.totalGbp !== null ? (
            <PriceBadge variant="current" className="recapStat--price">
              £{view.stats.totalGbp.toFixed(2)}
            </PriceBadge>
          ) : null}
        </div>
      </header>

      {view.route.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-route-title">
          <h2 id="recap-route-title" className="type-card-title recapSection__title">
            The route
          </h2>
          <ol className="recapRoute">
            {view.route.map((stop) => (
              <li key={`${stop.venueId}-${stop.position}`} className="recapRoute__stop">
                <span className="recapRoute__number" aria-hidden="true">
                  {stop.position + 1}
                </span>
                <div className="recapRoute__body">
                  <span className="recapRoute__name">{stop.venueName}</span>
                  {stop.caption ? <p className="recapRoute__caption">{stop.caption}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.photos.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-photos-title">
          <h2 id="recap-photos-title" className="type-card-title recapSection__title">
            Moments the crew shared
          </h2>
          <div className="recapPhotos">
            {view.photos.map((photo) => {
              const url = photoUrls.get(photo.id);
              return (
                <figure key={photo.id} className="recapPhoto">
                  {/* Approved photos only — every one cleared the consent gate. */}
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="recapPhoto__img" src={url} alt={photo.caption ?? "A moment from the night"} loading="lazy" />
                  ) : null}
                  {photo.caption ? <figcaption className="recapPhoto__caption type-meta">{photo.caption}</figcaption> : null}
                </figure>
              );
            })}
          </div>
        </section>
      ) : null}

      {view.pints.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-pints-title">
          <h2 id="recap-pints-title" className="type-card-title recapSection__title">
            Pints logged
          </h2>
          <ul className="recapPints">
            {view.pints.map((pint, index) => (
              <li key={`${pint.venueId}-${index}`} className="recapPint">
                <div className="recapPint__body">
                  <span className="recapPint__drink">{pint.drink ?? "A pint"}</span>
                  {pint.venueName ? <span className="recapPint__venue type-meta">{pint.venueName}</span> : null}
                  {pint.note ? <p className="recapPint__note">{pint.note}</p> : null}
                </div>
                {pint.priceLabel ? (
                  <PriceBadge variant="current" className="recapPint__price">
                    {pint.priceLabel}
                  </PriceBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="recapFooter" style={step()}>
        <p className="recapClosing">{view.closingLine}</p>
        <div className="recapFooter__actions">
          <RecapShareButton planId={storyId} shareText={shareText} shareUrl={`/recap/${storyId}`} />
          <Link className="recapFooter__plan" href="/plan">
            Plan your own night
          </Link>
        </div>
      </footer>
    </main>
  );
}
