import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { getVenueCuration } from "@/lib/curation";
import { getListedBuilding, type ListedBuilding } from "@/lib/heritageListings";
import {
  buildFamilyTableEntries,
  buildLedgerEntries,
  buildVenueClaims,
  ledgerClaimDrops,
  resolveFamilyTableDisplay,
  type RedactedFamilyEntry,
  type FamilyTableEntry,
} from "@/lib/ledger";
import { type ViewerContext } from "@/lib/pintDrops";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { isSupabaseConfigured } from "@/lib/supabase";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import JsonLd from "@/components/seo/JsonLd";
import OperatorRailPanel from "@/components/operators/OperatorRailPanel";
import ReadLedgerButton from "@/components/ledger/ReadLedgerButton";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import VenuePhotoWall from "@/components/venue/VenuePhotoWall";
import VisitReportPanel from "@/components/visits/VisitReportPanel";

import "./ledger.css";

// The Ledger (issue #25, PRD_FOR_FABLE.md § "The Spill"): a large-text,
// high-contrast, voice-friendly rendering of a venue's story for the
// Boomer/Gen-X reading surface. Same seams as the map's venue sheet and the
// /p/[id] permalink — the FULL venue detail (same cheap read path as
// app/api/venue/[id]) plus the same Pint Drop store the API route reads
// (lib/pintDropsStore) — reused, not rebuilt.
//
// A server component: no client fetch, so the first paint already carries the
// whole logbook. The only client-side sliver is the optional "Read this page"
// button (components/ledger/ReadLedgerButton), which is feature-detected and
// degrades to nothing when speechSynthesis is unsupported.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Mirrors app/api/venue/[id]'s memoized read: group the bundled dataset once
// per process and look venues up by id. Never throws — a read/parse failure
// yields an empty map so an unknown id 404s (friendly) instead of 500-ing.
let cachedVenues: Map<string, Venue> | null = null;

async function getVenue(id: string): Promise<Venue | null> {
  if (!cachedVenues) {
    const index = new Map<string, Venue>();
    try {
      await getVenueIndex(); // keeps the shared dataset read warm/memoized
      const { promises: fs } = await import("fs");
      const path = await import("path");
      const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
      const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
      for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
        index.set(venue.id, venue);
      }
    } catch {
      // leave `index` empty — degrade to notFound(), never a 500
    }
    cachedVenues = index;
  }
  const direct = cachedVenues.get(id);
  if (direct) return direct;
  // Resolve a merged duplicate id (D1) so a Ledger link to a losing id still
  // opens the surviving canonical venue.
  const canonical = await resolveCanonicalVenueId(id);
  return canonical === id ? null : cachedVenues.get(canonical) ?? null;
}

function pintDropStoreFor() {
  return isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
}

// Same posture as /p/[id]: JWT-derived viewer preferred; ?viewer= is
// development/test fallback only (never unlocks Family Table in production).
async function resolveViewer(
  searchParams?: PageProps["searchParams"],
): Promise<ViewerContext | undefined> {
  const h = await headers();
  const auth = h.get("authorization") ?? "";
  const reqHeaders: Record<string, string> = {};
  if (auth) reqHeaders.Authorization = auth;
  const request = new Request("http://localhost/ledger", { headers: reqHeaders });
  const params = searchParams ? await searchParams : undefined;
  const raw = params?.viewer;
  const queryViewer = Array.isArray(raw) ? raw[0] : raw;
  return resolveViewerContextFromRequest(request, queryViewer);
}

function isFullFamilyEntry(
  entry: FamilyTableEntry | RedactedFamilyEntry,
): entry is FamilyTableEntry {
  return "note" in entry;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const venue = await getVenue(id);

  if (!venue) {
    return {
      title: "The Ledger: PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `The Ledger: ${venue.name}. PUBMAXXING`;
  const description = `The story of ${venue.name} in ${venue.primaryBorough || "London"}. Heritage notes and the pub's logbook of visits, in large print.`;
  // Canonicalise onto the surviving canonical venue id (D1) so a merged/alias
  // URL points at the one indexable venue permalink.
  const canonical = `/ledger/${encodeURIComponent(venue.id)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "article", url: canonical },
    twitter: { card: "summary", title, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// BarOrPub structured data for the venue permalink (Wave S1.3). ONLY fields the
// dataset actually carries — name, geo (lat/lng), postal address, canonical url.
// No invented cuisine/priceRange/rating: provenance rule. lat/lng and address
// are omitted when absent rather than guessed. When the pub is on the official
// register (Historic England NHLE) we add a factual `description` + a
// heritage `additionalProperty` carrying the grade + list-entry citation, so
// AI/search engines see the listed-building status straight from the JSON-LD.
function venueJsonLd(venue: Venue, listed: ListedBuilding | null) {
  const hasGeo =
    typeof venue.latitude === "number" && typeof venue.longitude === "number";
  return {
    "@context": "https://schema.org",
    "@type": "BarOrPub",
    name: venue.name,
    url: `${SITE_URL}/ledger/${encodeURIComponent(venue.id)}`,
    ...(listed
      ? {
          description: listed.fact,
          additionalProperty: {
            "@type": "PropertyValue",
            name: "Listed building",
            value: `Grade ${listed.grade}`,
            url: listed.url,
          },
        }
      : {}),
    ...(venue.address || venue.primaryBorough
      ? {
          address: {
            "@type": "PostalAddress",
            ...(venue.address ? { streetAddress: venue.address } : {}),
            ...(venue.primaryBorough ? { addressLocality: venue.primaryBorough } : {}),
            addressRegion: "London",
            addressCountry: "GB",
          },
        }
      : {}),
    ...(hasGeo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: venue.latitude,
            longitude: venue.longitude,
          },
        }
      : {}),
  };
}

function NotInTheLedger() {
  return (
    <main id="main" className="ledgerPage ledgerPage--empty">
      <div className="ledgerEmptyCard">
        <Link className="ledgerHomeLink" href="/">
          PUBMAXXING
        </Link>
        <p className="ledgerEyebrow">The Ledger</p>
        <h1 className="ledgerEmptyTitle">This pub isn&rsquo;t in the ledger</h1>
        <p className="ledgerEmptyBody">
          It may have moved, or the link is wrong. Every mapped pub still has a home.
        </p>
        <Link className="ledgerPrimaryLink" href="/map">
          Back to the map
        </Link>
      </div>
    </main>
  );
}

export default async function LedgerPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const viewer = await resolveViewer(searchParams);
  const venue = await getVenue(id);
  if (!venue) return <NotInTheLedger />;
  // Per-request CSP nonce (proxy.ts) for the JSON-LD block.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Everything below reads/links off the canonical venue id (D1) so a merged
  // alias URL and the surviving canonical URL share the same logbook, Family
  // Table, and ratings — never the raw route param, which may be a losing
  // duplicate id.
  const canonicalId = venue.id;

  const curation = getVenueCuration(venue.prices);
  // Official listed-building record (Historic England NHLE), keyed by canonical
  // venue id — feeds the BarOrPub JSON-LD description below. null for the many
  // pubs that are not listed.
  const listedBuilding = await getListedBuilding(canonicalId);
  const drops = await pintDropStoreFor().listVisible(canonicalId);
  const claimDrops = ledgerClaimDrops(
    drops.map((d) => ({
      id: d.id,
      handle: d.handle,
      drink: d.drink,
      priceGbp: d.priceGbp,
      passedDownNote: d.passedDownNote,
      era: d.era,
      provenance: d.provenance,
      createdAt: d.createdAt,
    })),
  );
  const claims = buildVenueClaims(curation, claimDrops);
  const entries = buildLedgerEntries(
    drops.map((d) => ({
      id: d.id,
      handle: d.handle,
      drink: d.drink,
      priceGbp: d.priceGbp,
      passedDownNote: d.passedDownNote,
      era: d.era,
      provenance: d.provenance,
      createdAt: d.createdAt,
    })),
  );

  // The Family Table (issue #27): LEGACY drops, read via the ledger-only
  // listLegacyForVenue capability (issue #29) — deliberately a SEPARATE store
  // call from listVisible above, never a filter over `drops`, so a legacy row
  // can never accidentally end up rendered in the public logbook above.
  const legacyDrops = await pintDropStoreFor().listLegacyForVenue(canonicalId);
  const legacySources = legacyDrops.map((d) => ({
    id: d.id,
    handle: d.handle,
    drink: d.drink,
    priceGbp: d.priceGbp,
    passedDownNote: d.passedDownNote,
    era: d.era,
    provenance: d.provenance,
    createdAt: d.createdAt,
  }));
  // F4: public page redacts legacy rows unless the self-asserted viewer is the
  // drop's author (?viewer=, same courtesy curtain as /p/[id]). Everyone else
  // sees initials-style attribution and a generic family-table line — no price
  // or note body.
  const familyEntries = resolveFamilyTableDisplay(
    buildFamilyTableEntries(legacySources),
    legacySources,
    viewer?.handle,
  );
  // The Ledger's own canonical link, for the share actions below. Relative,
  // like every other in-app link on this page (venueMapUrl) — the deployed
  // origin is added by the browser/mail client itself. A future "email this
  // digest" project (see ShareWithFamilyButton's ponytail-ceiling note) would
  // want an absolute URL and should add a proper site-origin helper then.
  const ledgerUrl = `/ledger/${encodeURIComponent(canonicalId)}`;

  // Text handed to the "Read this page" button: name, heritage note, then the
  // newest few entries — kept short and skimmable for a screen reader / TTS
  // pass rather than reading the entire ledger aloud.
  const speechParts = [
    `The Ledger for ${venue.name}, ${venue.primaryBorough || "London"}.`,
    curation.heritageNote ? curation.heritageNote : "",
    ...entries
      .slice(0, 5)
      .map((entry) =>
        entry.dateLabel
          ? `${entry.dateLabel}: ${entry.note}`
          : entry.note,
      ),
  ].filter(Boolean);

  return (
    <main id="main" className="ledgerPage">
      <JsonLd data={venueJsonLd(venue, listedBuilding)} nonce={nonce} />
      <header className="ledgerHead">
        <Link className="ledgerHomeLink" href="/">
          PUBMAXXING
        </Link>
        <p className="ledgerEyebrow">The Ledger</p>
        <h1 className="ledgerTitle">{venue.name}</h1>
        <p className="ledgerAddress">
          {venue.address ? `${venue.address} · ` : ""}
          {venue.primaryBorough || "London"}
        </p>

        {/* Listed-building brass plaque (Historic England NHLE). Rendered only
            when the pub is on the official register; the citation link is the
            attribution required by the Open Government Licence. */}
        {listedBuilding ? (
          <a
            className="ledgerListedPlaque"
            href={listedBuilding.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="ledgerListedFact">{listedBuilding.fact}</span>
            <span className="ledgerListedSource">Historic England</span>
          </a>
        ) : null}

        <div className="ledgerHeadActions">
          <Link className="ledgerMapLink" href={venueMapUrl(canonicalId)}>
            Open on the map
          </Link>
          <Link className="ledgerMapLink" href={`/bar-tab/${encodeURIComponent(canonicalId)}`}>
            See the bar tab
          </Link>
          <ReadLedgerButton text={speechParts.join(" ")} />
          <ShareWithFamilyButton venueName={venue.name} url={ledgerUrl} label="Share this ledger" />
        </div>

        {/* Individual, dated Visit Reports. No score or aggregate verdict. */}
        <VisitReportPanel venueId={canonicalId} venueName={venue.name} />

        {/* The pub's community photo wall - the same one the map sheet shows. */}
        <VenuePhotoWall venueId={canonicalId} venueName={venue.name} />
      </header>

      <p className="ledgerLaneNote">
        Public notes appear in the logbook; Legacy notes are kept for the Family Table below.
      </p>

      {claims.length > 0 ? (
        <section className="ledgerSection" aria-labelledby="ledgerClaimsHeading">
          <h2 id="ledgerClaimsHeading" className="ledgerSectionTitle">
            The pub&rsquo;s story
          </h2>
          <ul className="ledgerClaimList">
            {claims.map((claim, index) => (
              <li className="ledgerClaim" key={`${claim.kind}-${index}`}>
                <span className={`ledgerProvenance ledgerProvenance--${claim.kind}`}>
                  {claim.label}
                </span>
                <p className="ledgerClaimBody">
                  {claim.content}
                  {claim.era ? <span className="ledgerClaimEra"> · {claim.era}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ledgerSection" aria-labelledby="ledgerEntriesHeading">
        <h2 id="ledgerEntriesHeading" className="ledgerSectionTitle">
          Logbook
        </h2>
        {entries.length === 0 ? (
          <p className="ledgerEmptyEntries">
            No entries logged yet. The first Pint Drop here will open the logbook.
          </p>
        ) : (
          <ol className="ledgerEntries" aria-label={`Logbook entries for ${venue.name}`}>
            {entries.map((entry) => (
              <li className="ledgerEntry" key={entry.id}>
                <article aria-label={`Logbook entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerEntryDate">Undated</span>
                    )}
                    <span
                      className={`ledgerProvenance ledgerProvenance--${entry.provenance}`}
                    >
                      {entry.provenance === "demo" ? "Demo" : entry.handle}
                    </span>
                  </div>
                  <p className="ledgerEntryNote">{entry.note}</p>
                  {entry.priceLabel ? (
                    <p className="ledgerEntryPrice">
                      <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                      <span className="ledgerEntryPriceValue">{entry.priceLabel}</span>
                    </p>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ledgerSection ledgerFamilySection" aria-labelledby="ledgerFamilyHeading">
        <div className="ledgerFamilyHead">
          <h2 id="ledgerFamilyHeading" className="ledgerSectionTitle">
            The Family Table
          </h2>
          <ShareWithFamilyButton venueName={venue.name} url={ledgerUrl} />
        </div>
        <p className="ledgerFamilyIntro">
          Some stories aren&rsquo;t for the feed. Kept here for whoever in the family reads them next.
        </p>
        {familyEntries.length === 0 ? (
          <p className="ledgerFamilyEmpty">
            Some stories are kept for the family table. Log a pint and choose Legacy to leave one.
          </p>
        ) : (
          <ol
            className="ledgerFamilyEntries"
            aria-label={`Family table entries for ${venue.name}`}
          >
            {familyEntries.map((entry) => (
              <li className="ledgerFamilyEntry" key={entry.id}>
                <article aria-label={`Family table entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerFamilyEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerFamilyEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerFamilyEntryDate">Undated</span>
                    )}
                    <span className="ledgerFamilyEntryHandle">
                      {entry.handle}
                      {entry.era ? <span className="ledgerClaimEra"> · {entry.era}</span> : null}
                    </span>
                  </div>
                  {isFullFamilyEntry(entry) ? (
                    <>
                      <p className="ledgerFamilyEntryNote">{entry.note}</p>
                      {entry.priceLabel ? (
                        <p className="ledgerEntryPrice">
                          <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                          <span className="ledgerEntryPriceValue">{entry.priceLabel}</span>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="ledgerFamilyEntryNote">A story kept for the family table.</p>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Operator rail (Wayfinder 3.5): a quiet door for the person who runs the
          pub. Signed-in users can verify they run it; verified operators propose
          corrections/events/offers that route through REVIEW and never overwrite
          the trusted notes above. */}
      <OperatorRailPanel venueId={canonicalId} venueName={venue.name} />

      <p className="ledgerFootnote">
        Sources, reports and price history. <Link href={venueMapUrl(canonicalId)}>See {venue.name} on the map →</Link>
      </p>
    </main>
  );
}
