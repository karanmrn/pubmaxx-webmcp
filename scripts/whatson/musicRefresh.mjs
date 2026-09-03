// scripts/whatson/musicRefresh.mjs
//
// Pure generator for the What's-On MUSIC vertical (PRD_WHATS_ON B5, last of
// the four verticals). No fetching here: every function is a plain transform
// over a small, hand-curated, hand-verified residency list, so the whole
// module unit-tests offline. Orchestration (write output) lives in main()
// below, mirroring scripts/whatson/dealsRefresh.mjs / sportFixtures.mjs.
//
// GOVERNANCE — first-party, individually-verified residency nights ONLY:
//   Every entry in MUSIC_RESIDENCIES below is a weekly recurring live-music
//   night published on the PUB'S OWN website (never a listings/ticketing
//   aggregator — DesignMyNight, Songkick, Eventbrite etc. were used only to
//   discover candidate venues, then every candidate was re-verified against
//   the venue's own site before being included; several candidates found via
//   aggregators were DROPPED below precisely because the pub's own site
//   either didn't confirm a specific day/time or couldn't be reached — see
//   DROPPED CANDIDATES). No venue attribute in the existing datasets
//   (pint_prices_app_dataset.json's `live_music` field) carries any value —
//   every row it every pub is an empty string — so there is no first-party
//   structured signal to cross-reference the way sportFixtures.mjs does; this
//   vertical is entirely hand-seeded instead.
//
// SCOPE — PRD_WHATS_ON B5 explicitly accepts thin coverage over invented
// coverage ("a dozen verified venues beats 200 invented"). Two verification
// passes (2026-07-12) across well-known London live-music pubs produced the
// six venues below — each with an unambiguous weekly day + start time on its
// own site. Weekly-only for now: the row contract would also support one-off
// dated gig rows, but no first-party dated-gig source verified this pass was
// clean enough to justify expanding the generator, so this stays weekly-only.
//
// DROPPED CANDIDATES (investigated on their OWN sites, not included):
//   The Gladstone Arms (thegladpub.co.uk) — "gigs every Tuesday and Sunday"
//     confirmed, no start time stated. The Old Blue Last (theoldbluelast.com)
//     — "EVERY SUNDAY" jazz confirmed, no time. The Grafton NW5 — acoustic
//     night is "every other Thursday" (biweekly, not weekly). The Betsey
//     Trotwood (thebetsey.com) — alternate-Thursday folk (biweekly). Duke of
//     Kendal (thedukeofkendal.co.uk + dukeofkendal.co.uk) — 404/403 on every
//     path tried; could not re-verify secondary-source claims. TAM Elephant &
//     Castle (tam.tv) — only a stale dated 2023 event page. The Blues Kitchen
//     (theblueskitchen.com) — "live music until late every night" but no
//     per-night start time published. Dublin Castle (thedublincastle.com) —
//     page served no readable schedule; dated one-off gigs only. Green Note
//     (greennote.co.uk) — dated one-off gigs only, no fixed weekly night.
//     Half Moon Putney (halfmoon.co.uk) — "New Moon Monday" named on the
//     homepage but its own ticket listings show it as bank-holiday specials,
//     not a fixed weekly slot; no weekly day+time stated. Bull's Head Barnes
//     (thebullshead.com) — site unreachable (connection refused) at both
//     verification attempts. Ain't Nothin' But SUNDAY afternoon jam — day
//     confirmed on the venue's own site, but no Sunday start time found
//     (only the Monday jam's 8pm is published), so only Monday is included.
//   606 Club — skipped: a members/supper jazz club, not a pub.
//
// RECURRENCE MODEL — same technique as the deals vertical: each row is "the
// next occurrence" of a weekly residency slot, computed DST-aware in
// Europe/London via nextWeeklyOccurrence (imported from quizParsers.mjs — same
// module the quiz + deals verticals already share). No endsAt: unlike a
// Wetherspoons deal day (a fixed 11:30-23:00 window stated by the chain),
// none of these residencies' own pages state how long the set runs — omitted
// rather than guessed.
//
// VENUE MATCHING (W6): each seed entry carries the venue's own published
// street address + postcode (hand-verified, same first-party standard as
// the residency slots themselves), passed into resolveVenueId so its
// conservative fallback (normalized-name match confirmed by postcode
// district or <=75m proximity) can fire. HONEST CURRENT STATE: none of the
// five venues below exists in the canonical pint_prices_app_dataset.json
// (checked 2026-07-12 — zero normalized-name candidates for any of them),
// so every row currently ships unresolved; the postcodes are carried so
// resolution lights up automatically the moment the canonical dataset grows
// to include these pubs, with no generator change needed. `venueId` is only
// ever set when resolveVenueId returns non-null.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextWeeklyOccurrence } from "./quizParsers.mjs";
import { resolveVenueId, loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "music_london.json");

// Skehan's own "What's On" / "Live Music" pages, checked 2026-07-12: a full
// weekly programme with day + start time stated for every slot below (Friday
// alternates Karaoke/Rock'n'Roll, ambiguous, so it is NOT included).
export const SKEHANS_SOURCE = {
  label: "Skehan's — Live Music",
  url: "https://skehans.com/whats-on/",
};

// The Ivy House's own "What's On" page, checked 2026-07-12: "Jazz + Roasts
// Sundays" — a recurring Sunday-afternoon jazz session with roast dinners,
// 4pm start, free entry.
export const IVY_HOUSE_SOURCE = {
  label: "The Ivy House — What's On",
  url: "https://www.ivyhousenunhead.com/whats-on",
};

// The Spice of Life's own events page, checked 2026-07-12: two explicitly
// weekly residencies — "DOVE JONES CONNECTION BLUES & JAZZ JAM PARTY … Every
// Monday Doors at 7pm" and "Jazz Notes Jazz Jam … Every Sunday Doors at 1pm".
export const SPICE_OF_LIFE_SOURCE = {
  label: "The Spice of Life — Events",
  url: "https://www.spiceoflifesoho.com/events/",
};

// Ain't Nothin' But's own site, checked 2026-07-12: "Our jams are held on
// Sunday afternoons and Monday nights" (aintnothinbut.co.uk), with the Monday
// Blues Jam's own listing on the venue's What's On page stating 8pm-1am.
// The Sunday jam carries no published start time, so only Monday is emitted.
export const AINT_NOTHIN_BUT_SOURCE = {
  label: "Ain't Nothin' But — What's On",
  url: "https://www.aintnothinbut.co.uk/whatson",
};

// The Troubadour's own Sunday Jazz page, checked 2026-07-12: a longstanding
// weekly Jazz Sundays residency directed by Sebastiaan de Krom; doors/table
// reservations 7:30pm, artists play 8pm-10:30pm.
export const TROUBADOUR_SOURCE = {
  label: "Troubadour — Sunday Jazz",
  url: "https://www.troubadourlondon.com/sunday-jazz",
};

// Every entry MUST already be a currently-published, unambiguous weekly
// residency on the venue's own site — never a guessed day/time or a
// biweekly/alternating slot (see DROPPED CANDIDATES above). Add/remove/
// re-check on the periodic refresh.
export const MUSIC_RESIDENCIES = [
  {
    id: "skehans-monday-jam",
    placeName: "Skehan's",
    address: "1 Kitto Road, Telegraph Hill, London",
    postcode: "SE14 5TW",
    dayName: "Monday",
    startTime: "20:30",
    title: "Monday Jam Sessions",
    detail:
      "An inclusive jam session open to all patrons — bring your own instrument and join in, or just come to listen.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-tuesday-trad",
    placeName: "Skehan's",
    address: "1 Kitto Road, Telegraph Hill, London",
    postcode: "SE14 5TW",
    dayName: "Tuesday",
    startTime: "19:00",
    title: "Irish/English Trad Session",
    detail: "Traditional Irish and English music session, alternating performers every Tuesday.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-wednesday-jam",
    placeName: "Skehan's",
    address: "1 Kitto Road, Telegraph Hill, London",
    postcode: "SE14 5TW",
    dayName: "Wednesday",
    startTime: "20:00",
    title: "South London Jam",
    detail: "An eclectic mix of musicians getting together for a live jam.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-saturday-gig",
    placeName: "Skehan's",
    address: "1 Kitto Road, Telegraph Hill, London",
    postcode: "SE14 5TW",
    dayName: "Saturday",
    startTime: "21:00",
    title: "The Big Saturday Night Gig",
    detail: "Live music from Skehan's regular roster of musicians, into the night.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-sunday-folk",
    placeName: "Skehan's",
    address: "1 Kitto Road, Telegraph Hill, London",
    postcode: "SE14 5TW",
    dayName: "Sunday",
    startTime: "19:00",
    title: "Sunday Night Folk Sessions",
    detail: "Live folk music session.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "ivyhouse-sunday-jazz",
    placeName: "The Ivy House",
    address: "40 Stuart Road, Nunhead, London",
    postcode: "SE15 3BE",
    dayName: "Sunday",
    startTime: "16:00",
    title: "Jazz + Roasts Sundays",
    detail:
      "Live jazz band on the community pub's stage, paired with Sunday roasts. Free entry; booking recommended for food.",
    source: IVY_HOUSE_SOURCE,
  },
  {
    id: "spiceoflife-monday-jam",
    placeName: "The Spice of Life",
    address: "6 Moor Street, Cambridge Circus, London",
    postcode: "W1D 5NA",
    dayName: "Monday",
    startTime: "19:00",
    title: "Dove Jones Connection Blues & Jazz Jam Party",
    detail:
      "Weekly blues and jazz jam residency on the Spice of Life stage. Doors 7pm, per the venue's own events page.",
    source: SPICE_OF_LIFE_SOURCE,
  },
  {
    id: "spiceoflife-sunday-jazzjam",
    placeName: "The Spice of Life",
    address: "6 Moor Street, Cambridge Circus, London",
    postcode: "W1D 5NA",
    dayName: "Sunday",
    startTime: "13:00",
    title: "Jazz Notes Jazz Jam",
    detail:
      "Weekly Sunday-afternoon jazz jam — instrumentalists and singers welcome to join on the day. Doors 1pm, per the venue's own events page.",
    source: SPICE_OF_LIFE_SOURCE,
  },
  {
    id: "aintnothinbut-monday-bluesjam",
    placeName: "Ain't Nothin' But",
    address: "20 Kingly Street, Soho, London",
    postcode: "W1B 5PZ",
    dayName: "Monday",
    startTime: "20:00",
    title: "Monday Night Blues Jam",
    detail:
      "The Soho blues bar's famous Monday night Blues Jam, 8pm-1am — bring your instrument and sign up on the night.",
    source: AINT_NOTHIN_BUT_SOURCE,
  },
  {
    id: "troubadour-sunday-jazz",
    placeName: "Troubadour",
    address: "263-267 Old Brompton Road, Earls Court, London",
    postcode: "SW5 9JA",
    dayName: "Sunday",
    startTime: "20:00",
    title: "Jazz Sundays",
    detail:
      "Longstanding weekly jazz residency directed by Sebastiaan de Krom. Doors and table reservations 7:30pm; artists play 8pm-10:30pm. Booking recommended.",
    source: TROUBADOUR_SOURCE,
  },
];

// ---------------------------------------------------------------------------
// Row building (pure)
// ---------------------------------------------------------------------------

// Build weekly music-residency rows (B1 row contract, confidence:"listed" — a
// first-party published programme, not a per-night confirmation that this
// exact lineup plays this exact week). A residency whose weekly slot cannot
// be resolved (malformed day/time) is dropped, never guessed.
export function buildMusicResidencyRows({ residencies, observedAt, venueIndex = null }) {
  const rows = [];
  for (const res of residencies ?? []) {
    const startsAt = nextWeeklyOccurrence(res?.dayName, res?.startTime, observedAt);
    if (!startsAt) continue;
    if (typeof res.placeName !== "string" || res.placeName.length === 0) continue;
    if (typeof res.id !== "string" || res.id.length === 0) continue;
    // Validate title and detail at row build time (B1 contract requires both;
    // empty title would pass here but get silently dropped later by isValidWhatsOnRow,
    // so catch it now and count it toward the abort guard).
    if (typeof res.title !== "string" || res.title.length === 0) continue;
    if (typeof res.detail !== "string" || res.detail.length === 0) continue;

    const row = {
      id: `music-${res.id}`,
      placeName: res.placeName,
      kind: "music",
      startsAt,
      title: res.title,
      detail: res.detail,
      source: { ...res.source },
      observedAt,
      confidence: "listed",
    };
    if (venueIndex) {
      const resolved = resolveVenueId(
        { name: res.placeName, address: res.address, postcode: res.postcode },
        venueIndex,
      );
      if (resolved) row.venueId = resolved;
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------------------------------------------------------------------
// main: write public/data/whats_on/music_london.json
// ---------------------------------------------------------------------------

function main() {
  const observedAt = new Date().toISOString();

  const venueIndex = loadCanonicalVenueIndex();
  const rows = buildMusicResidencyRows({ residencies: MUSIC_RESIDENCIES, observedAt, venueIndex });

  // Fail closed: never let a silent regression (malformed day/time, dropped
  // entries) collapse the baseline to zero while main() still reports
  // success. The whole seed is small and hand-curated, so require every
  // residency to have resolved — with an --allow-empty escape hatch (mirrors
  // sportFixtures.mjs / dealsRefresh.mjs pattern) for the rare legitimate case
  // of a refresh that intentionally drops every entry pending re-verification.
  const allowEmpty = process.argv.includes("--allow-empty");
  if (rows.length === 0 && !allowEmpty) {
    console.error(
      `musicRefresh: aborting — generated 0 rows from ${MUSIC_RESIDENCIES.length} residency ` +
        `definition(s). Refusing to overwrite ${OUT_PATH} with an empty result. ` +
        "Pass --allow-empty to override.",
    );
    process.exitCode = 1;
    return;
  }
  if (rows.length < MUSIC_RESIDENCIES.length && !allowEmpty) {
    console.error(
      `musicRefresh: aborting — generated ${rows.length} row(s) from ` +
        `${MUSIC_RESIDENCIES.length} residency definition(s); at least one dropped ` +
        "(malformed day/time or missing placeName/id). Refusing to overwrite " +
        `${OUT_PATH} silently. Pass --allow-empty to override.`,
    );
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: observedAt,
    kind: "music",
    region: "greater-london",
    sources: [
      {
        ...SKEHANS_SOURCE,
        firstParty: true,
        notes:
          "Skehan's own weekly live-music programme (checked 2026-07-12): " +
          "Monday Jam Sessions 20:30, Tuesday Trad Session 19:00, Wednesday " +
          "South London Jam 20:00, The Big Saturday Night Gig 21:00, Sunday " +
          "Night Folk Sessions 19:00. Friday alternates Karaoke/Rock'n'Roll — " +
          "not included (ambiguous which runs on a given week).",
      },
      {
        ...IVY_HOUSE_SOURCE,
        firstParty: true,
        notes:
          "The Ivy House's own 'Jazz + Roasts Sundays' — recurring Sunday " +
          "16:00 live jazz session, checked 2026-07-12.",
      },
      {
        ...SPICE_OF_LIFE_SOURCE,
        firstParty: true,
        notes:
          "The venue's own events page (checked 2026-07-12): 'Dove Jones " +
          "Connection Blues & Jazz Jam Party … Every Monday Doors at 7pm' and " +
          "'Jazz Notes Jazz Jam … Every Sunday Doors at 1pm'.",
      },
      {
        ...AINT_NOTHIN_BUT_SOURCE,
        firstParty: true,
        notes:
          "The venue's own site (checked 2026-07-12): jams 'Sunday afternoons " +
          "and Monday nights'; the Monday Blues Jam's own What's-On listing " +
          "states 8pm-1am. Sunday jam has no published start time, so only " +
          "Monday is emitted.",
      },
      {
        ...TROUBADOUR_SOURCE,
        firstParty: true,
        notes:
          "The venue's own Sunday Jazz page (checked 2026-07-12): weekly " +
          "residency, doors 7:30pm, artists 8pm-10:30pm.",
      },
    ],
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs (mirrors
  // quizRefresh.mjs / sportFixtures.mjs / dealsRefresh.mjs).
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} music-residency rows -> ${OUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
