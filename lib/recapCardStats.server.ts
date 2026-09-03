import "server-only";

import { getPublishedRecapSource } from "@/lib/nightMemoryStore";
import { composeRecapFromPublishedStory } from "@/lib/recapView";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import type { RecapCardStats } from "@/lib/recapCard";
import { getVenueIndex, type VenueRef } from "@/lib/venueIndex";
import type { NightMoment } from "@/lib/nightMemory";
import type { PintDrop } from "@/lib/pintDropShared";

// Server-only by the `.server.ts` convention used across lib/ (e.g.
// pintIndexSnapshot.server.ts): imported only by the Node-runtime OG route.

// Single integration seam between the recap OG card (Lane 3) and the public-safe
// recap composer (Lane 2). The card route calls ONLY this function — it never
// joins the plan store or resolves crew handles itself.
//
// Lane 2 owns the pure public composer `lib/recapView.ts`.
// It stays null-safe: `composeRecapFromPublishedStory` returns null unless the
// story is published + not-private, and it reads only the already published
// moment allowlist. Ownership split:
//   • Lane 2 sources stopCount / pintCount / cheapest price / (route stops).
//   • Lane 3 (here) sources boroughsCrossed (venue index). Crew stays empty:
//     published Moment ownership is not an explicit crew identity consent.
//   • ending is NULL on the public path by design (it lives on the plan
//     completion, which the public story does not join). RecapCardStats.ending
//     is nullable and the card hides the ending tile when absent.
//
// `getPublishedRecapSource` is the ONE public privacy choke point. It performs
// the published/non-private check, applies the published-moment allowlist, and
// redacts departed contributors before this module sees a Moment. All joins
// below are therefore best-effort enrichment of that public-safe source.

// A recap card needs every published Pint Drop Moment for its count. Keep the
// public price enrichment bounded even when a Story names many Pint Drop
// venues. A partial price join keeps the count but cannot claim a cheapest
// price.
const MAX_RECAP_PINT_DROP_VENUE_READS = 12;
const RECAP_PINT_DROP_READ_CONCURRENCY = 4;

type PublicPintDropRead = {
  dropsById: Map<string, PintDrop>;
  complete: boolean;
};

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function uniqueVenueIds(moments: NightMoment[]): string[] {
  return [...new Set(moments.map((moment) => nonEmpty(moment.venueId)).filter((id): id is string => id !== null))];
}

function publicDropForComposer(drop: PintDropDTO): PintDrop {
  // PintDropDTO has already stripped report/moderation metadata and storage
  // keys. Copy only fields the pure composer needs so a future DTO field cannot
  // accidentally become part of a public recap stats object.
  return {
    id: drop.id,
    venueId: drop.venueId,
    handle: drop.handle,
    drink: drop.drink,
    priceGbp: drop.priceGbp,
    passedDownNote: drop.passedDownNote,
    era: drop.era,
    ...(drop.vibeTags ? { vibeTags: drop.vibeTags } : {}),
    provenance: drop.provenance,
    status: drop.status,
    ...(drop.visibility ? { visibility: drop.visibility } : {}),
    createdAt: drop.createdAt,
    ...(drop.leaveByIso ? { leaveByIso: drop.leaveByIso } : {}),
    ...(drop.lastTrainDecision ? { lastTrainDecision: drop.lastTrainDecision } : {}),
  };
}

async function readPublicPintDrops(
  moments: NightMoment[],
): Promise<PublicPintDropRead> {
  const pintDropMoments = moments.filter((moment) => moment.kind === "pint_drop");
  if (pintDropMoments.length === 0) return { dropsById: new Map(), complete: true };

  let complete = true;
  const requestedDropIds = new Set<string>();
  const allVenueIds = new Set<string>();
  for (const moment of pintDropMoments) {
    const dropId = nonEmpty(moment.pintDropId);
    const venueId = nonEmpty(moment.venueId);
    if (!dropId || !venueId) {
      complete = false;
      continue;
    }
    requestedDropIds.add(dropId);
    allVenueIds.add(venueId);
  }
  if (requestedDropIds.size === 0 || allVenueIds.size === 0) {
    return { dropsById: new Map(), complete: false };
  }

  const allVenueIdList = [...allVenueIds];
  if (allVenueIdList.length > MAX_RECAP_PINT_DROP_VENUE_READS) complete = false;
  const venueIds = allVenueIdList.slice(0, MAX_RECAP_PINT_DROP_VENUE_READS);

  const out = new Map<string, PintDrop>();
  let store: ReturnType<typeof pintDropsStore>;
  try {
    store = pintDropsStore();
  } catch {
    return { dropsById: out, complete: false };
  }

  let nextVenueIndex = 0;
  const readVenue = async (): Promise<void> => {
    while (nextVenueIndex < venueIds.length) {
      const venueId = venueIds[nextVenueIndex];
      nextVenueIndex += 1;
      try {
        const drops = await store.listVisible(venueId);
        for (const drop of drops) {
          if (requestedDropIds.has(drop.id)) out.set(drop.id, publicDropForComposer(drop));
        }
      } catch {
        // One unavailable venue read must not erase stats for other venues.
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(RECAP_PINT_DROP_READ_CONCURRENCY, venueIds.length) },
      () => readVenue(),
    ),
  );
  for (const dropId of requestedDropIds) {
    if (!out.has(dropId)) complete = false;
  }
  return { dropsById: out, complete };
}

async function readVenueRefs(): Promise<Map<string, VenueRef>> {
  try {
    const index = await getVenueIndex();
    return index instanceof Map ? index : new Map();
  } catch {
    // Venue names and boroughs are enrichment. The public recap still has
    // honest route/pint stats when the packaged index is unavailable.
    return new Map();
  }
}

function boroughCount(moments: NightMoment[], venueIndex: Map<string, VenueRef>): number {
  const boroughs = new Set<string>();
  for (const venueId of uniqueVenueIds(moments.filter((moment) => moment.kind === "venue"))) {
    const borough = nonEmpty(venueIndex.get(venueId)?.borough);
    if (borough) boroughs.add(borough);
  }
  return boroughs.size;
}

export async function recapCardStats(storyId: string): Promise<RecapCardStats | null> {
  let source: Awaited<ReturnType<typeof getPublishedRecapSource>>;
  try {
    source = await getPublishedRecapSource(storyId);
  } catch {
    return null;
  }
  if (!source) return null;

  const [venueIndex, pintDropRead] = await Promise.all([
    readVenueRefs(),
    readPublicPintDrops(source.moments),
  ]);
  const venueNames = new Map<string, string>();
  for (const venueId of uniqueVenueIds(source.moments)) {
    const name = nonEmpty(venueIndex.get(venueId)?.name);
    if (name) venueNames.set(venueId, name);
  }

  let view: ReturnType<typeof composeRecapFromPublishedStory>;
  try {
    view = composeRecapFromPublishedStory({
      story: source.story,
      moments: source.moments,
      pintDropsById: pintDropRead.dropsById,
      venueNames,
    });
  } catch {
    return null;
  }
  if (!view) return null;

  return {
    stopCount: view.stats.stopCount,
    pintsLogged: view.stats.pintCount,
    boroughsCrossed: boroughCount(source.moments, venueIndex),
    ending: view.ending?.kind ?? null,
    cheapestPintGbp: pintDropRead.complete ? view.stats.cheapestPintGbp : null,
    crew: [],
    nightDateIso: view.completedAt ?? source.story.publishedAt,
  };
}
