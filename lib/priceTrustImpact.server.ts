import "server-only";

// Price trust impact: create first-cluster unlocks and read the owner's card.
//
// Trust itself lives in lib/communityPrice.ts. This module only reacts when a
// write-back or a hide changes that answer, and it never invents a second
// threshold. Fail-soft: a price write still lands if this sync cannot.

import {
  countCommunityPriceObservationsForActor,
  findCommunityPriceObservation,
  listCommunityPriceObservations,
  listCommunityPriceObservationsForPairs,
  type CommunityPriceObservation,
} from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { profileStore } from "@/lib/profileStore";
import {
  priceTrustEventStore,
  type PriceTrustEvent,
  type PriceTrustReconciliationTask,
} from "@/lib/priceTrustEventStore";
import {
  categoryIsTrusted,
  firstQualifyingCluster,
  profileIdFromActor,
  reversalFingerprint,
  trustEventFingerprint,
  type TrustObservation,
} from "@/lib/priceTrustEvents";

export type PriceTrustImpactReady = {
  status: "ready";
  observationsLogged: number;
  pricesTrustedNow: number;
  lifetimeTrustUnlocks: number;
};

export type PriceTrustImpact =
  | PriceTrustImpactReady
  | { status: "degraded" };

export type PriceTrustReconciliation =
  | { status: "synced" }
  | { status: "unavailable" };

export type PriceTrustObservationReconciliation =
  | PriceTrustReconciliation
  | { status: "not-found" };

export type PriceTrustReconciliationDrain = {
  processed: number;
  synced: number;
  pending: number;
  degraded: boolean;
};

const STORE_TAG = "price-trust-events";
const TRUST_SYNCED: PriceTrustReconciliation = { status: "synced" };
const TRUST_UNAVAILABLE: PriceTrustReconciliation = { status: "unavailable" };
const TRUST_NOT_FOUND: PriceTrustObservationReconciliation = { status: "not-found" };
const PRICE_TRUST_RECONCILIATION_BUDGET = 3;

type PriceTrustReconciliationBudget = { remaining: number };

type PreparedPriceTrustReconciliation =
  | { status: "synced"; task: PriceTrustReconciliationTask }
  | { status: "unavailable"; task: PriceTrustReconciliationTask | null };

function createReconciliationBudget(): PriceTrustReconciliationBudget {
  return { remaining: PRICE_TRUST_RECONCILIATION_BUDGET };
}

function consumeReconciliationStep(budget: PriceTrustReconciliationBudget): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}

function pairKey(venueId: string, category: DrinkCategory): string {
  return `${venueId}\0${category}`;
}

function asTrustObservations(
  rows: readonly CommunityPriceObservation[],
): TrustObservation[] {
  return rows.map((row) => ({
    id: row.id,
    venueId: row.venueId,
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
    submittedAt: row.submittedAt,
    actor: row.actor,
    hidden: row.hidden,
  }));
}

async function userIdsForActors(
  actors: readonly string[],
): Promise<string[] | null> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const actor of actors) {
    const profileId = profileIdFromActor(actor);
    if (!profileId) continue;
    const profile = await profileStore().getById(profileId);
    const userId = profile?.userId?.trim();
    if (!userId) return null;
    if (seen.has(userId)) continue;
    seen.add(userId);
    ids.push(userId);
  }
  return ids;
}

async function recordFirstCluster(
  venueId: string,
  category: DrinkCategory,
  observations: readonly TrustObservation[],
  now: number,
  restorationKey?: string,
): Promise<PriceTrustReconciliation> {
  const cluster = firstQualifyingCluster(observations, now);
  if (!cluster) return TRUST_SYNCED;
  const userIds = await userIdsForActors(cluster.actors);
  if (!userIds) return TRUST_UNAVAILABLE;
  if (cluster.actors.length > 0 && userIds.length === 0) return TRUST_SYNCED;
  const store = priceTrustEventStore();
  const fingerprint = trustEventFingerprint(venueId, category, cluster.observationIds);
  const written = await store.recordUnlock({
    // A previous unlock may have a hide reversal. Restoring the observation
    // needs a new positive event because the original fingerprint remains
    // append-only and cannot be reused as visible credit.
    fingerprint: restorationKey ? `restored:${fingerprint}:${restorationKey}` : fingerprint,
    venueId,
    category,
    observationIds: cluster.observationIds,
    userIds,
    now,
  });
  if (written.failed || !written.event) return TRUST_UNAVAILABLE;

  const live = await store.liveEventsFor(venueId, category);
  if (live.degraded || live.events.length > 1) return TRUST_UNAVAILABLE;
  if (live.events.length === 1) return TRUST_SYNCED;
  if (restorationKey || written.created) return TRUST_UNAVAILABLE;

  // The evidence fingerprint is append-only. A repeated qualifying cluster can
  // therefore reuse an older positive event which a hide already reversed.
  // Key the replacement to that chain's terminal reversal, then prove a live
  // event exists before the reconciliation queue can be acknowledged.
  const reversal = await store.terminalReversalFor(written.event);
  if (reversal.degraded || !reversal.event) return TRUST_UNAVAILABLE;
  const restored = await store.recordUnlock({
    fingerprint: `restored:${fingerprint}:${reversal.event.id}`,
    venueId,
    category,
    observationIds: cluster.observationIds,
    userIds,
    now,
  });
  if (restored.failed || !restored.event) return TRUST_UNAVAILABLE;
  const verified = await store.liveEventsFor(venueId, category);
  return !verified.degraded && verified.events.length === 1
    ? TRUST_SYNCED
    : TRUST_UNAVAILABLE;
}

async function repairEventCredits(
  event: PriceTrustEvent,
  observations: readonly CommunityPriceObservation[],
): Promise<PriceTrustReconciliation> {
  if (event.observationIds.length === 0) return TRUST_UNAVAILABLE;
  const byId = new Map(observations.map((row) => [row.id, row]));
  const evidence = event.observationIds.map((id) => byId.get(id));
  if (evidence.some((row) => !row || row.hidden)) return TRUST_UNAVAILABLE;
  const actors = evidence
    .map((row) => row?.actor)
    .filter((actor): actor is string => typeof actor === "string" && actor !== "");
  const userIds = await userIdsForActors(actors);
  if (!userIds) return TRUST_UNAVAILABLE;
  const ensured = await priceTrustEventStore().ensureCredits(event.id, userIds);
  return ensured.failed ? TRUST_UNAVAILABLE : TRUST_SYNCED;
}

export async function reconcilePendingPriceTrust(
  task: PriceTrustReconciliationTask,
  now: number = Date.now(),
): Promise<PriceTrustReconciliation> {
  try {
    const listed = await listCommunityPriceObservations(
      task.venueId,
      task.category,
    );
    if (listed.degraded) return TRUST_UNAVAILABLE;
    const live = await priceTrustEventStore().liveEventsFor(
      task.venueId,
      task.category,
    );
    if (live.degraded || live.events.length > 1) return TRUST_UNAVAILABLE;
    if (live.events.length === 1) {
      return repairEventCredits(live.events[0], listed.observations);
    }
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return TRUST_SYNCED;
    return recordFirstCluster(task.venueId, task.category, observations, now);
  } catch (error) {
    console.warn(`${STORE_TAG} pending pair reconciliation failed`, error);
    return TRUST_UNAVAILABLE;
  }
}

export async function drainPendingPriceTrustReconciliations(
  limit: number = 20,
  now: number = Date.now(),
): Promise<PriceTrustReconciliationDrain> {
  const listed = await priceTrustEventStore().listPendingReconciliations(limit);
  if (listed.degraded) {
    return { processed: 0, synced: 0, pending: 0, degraded: true };
  }
  let synced = 0;
  let pending = 0;
  for (const task of listed.tasks) {
    const result = await reconcilePendingPriceTrust(task, now);
    if (result.status === "unavailable") {
      await priceTrustEventStore().enqueueReconciliation(
        task.venueId,
        task.category,
        now,
      );
      pending += 1;
      continue;
    }
    const acknowledged = await priceTrustEventStore().ackReconciliation(task);
    if (acknowledged.failed) {
      pending += 1;
      continue;
    }
    if (acknowledged.acknowledged) synced += 1;
    else pending += 1;
  }
  return {
    processed: listed.tasks.length,
    synced,
    pending,
    degraded: false,
  };
}

export async function syncTrustAfterPriceWrite(
  venueId: string,
  category: DrinkCategory,
  now: number = Date.now(),
): Promise<PriceTrustReconciliation> {
  const prepared = await preparePriceTrustAfterWrite(venueId, category, now);
  if (prepared.status === "unavailable") return TRUST_UNAVAILABLE;
  return acknowledgePreparedPriceTrust(prepared.task);
}

async function preparePriceTrustAfterWrite(
  venueId: string,
  category: DrinkCategory,
  now: number,
): Promise<PreparedPriceTrustReconciliation> {
  try {
    const enqueued = await priceTrustEventStore().enqueueReconciliation(
      venueId,
      category,
      now,
    );
    if (enqueued.failed || !enqueued.task) {
      return { status: "unavailable", task: null };
    }
    const reconciled = await reconcilePendingPriceTrust(enqueued.task, now);
    return reconciled.status === "unavailable"
      ? { status: "unavailable", task: enqueued.task }
      : { status: "synced", task: enqueued.task };
  } catch (error) {
    console.warn(`${STORE_TAG} sync after write failed`, error);
    return { status: "unavailable", task: null };
  }
}

async function acknowledgePreparedPriceTrust(
  task: PriceTrustReconciliationTask,
): Promise<PriceTrustReconciliation> {
  try {
    const acknowledged = await priceTrustEventStore().ackReconciliation(
      task,
    );
    if (acknowledged.failed || !acknowledged.acknowledged) {
      return TRUST_UNAVAILABLE;
    }
    return TRUST_SYNCED;
  } catch (error) {
    console.warn(`${STORE_TAG} sync after write failed`, error);
    return TRUST_UNAVAILABLE;
  }
}

function sameObservationIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.every((id, index) => id === orderedRight[index]);
}

async function proveCurrentPriceTrustInvariant(
  observationId: string,
  venueId: string,
  category: DrinkCategory,
  now: number,
): Promise<PriceTrustObservationReconciliation> {
  const before = await findCommunityPriceObservation(observationId);
  if (before.degraded) return TRUST_UNAVAILABLE;
  if (!before.observation) return TRUST_NOT_FOUND;
  if (
    before.observation.venueId !== venueId
    || before.observation.drinkCategory !== category
  ) {
    return TRUST_UNAVAILABLE;
  }

  const listed = await listCommunityPriceObservations(venueId, category);
  if (listed.degraded) return TRUST_UNAVAILABLE;
  const observations = asTrustObservations(listed.observations);
  const currentCluster = firstQualifyingCluster(observations, now);
  const live = await priceTrustEventStore().liveEventsFor(venueId, category);
  if (live.degraded || live.events.length > 1) return TRUST_UNAVAILABLE;
  if (currentCluster && live.events.length !== 1) return TRUST_UNAVAILABLE;

  const event = live.events[0];
  if (event) {
    const byId = new Map(listed.observations.map((row) => [row.id, row]));
    const evidence = event.observationIds
      .map((id) => byId.get(id))
      .filter((row): row is CommunityPriceObservation => row !== undefined);
    const eventAt = Date.parse(event.createdAt);
    const evidenceCluster = Number.isFinite(eventAt)
      ? firstQualifyingCluster(asTrustObservations(evidence), eventAt)
      : null;
    if (
      !evidenceCluster
      || !sameObservationIds(evidenceCluster.observationIds, event.observationIds)
    ) {
      return TRUST_UNAVAILABLE;
    }
    const credits = await repairEventCredits(event, listed.observations);
    if (credits.status === "unavailable") return credits;
  }

  if (before.observation.hidden) {
    const covering = await priceTrustEventStore().liveEventsCovering(observationId);
    if (covering.degraded || covering.events.length > 0) return TRUST_UNAVAILABLE;
  }

  const after = await findCommunityPriceObservation(observationId);
  if (after.degraded) return TRUST_UNAVAILABLE;
  if (!after.observation) return TRUST_NOT_FOUND;
  if (
    after.observation.venueId !== venueId
    || after.observation.drinkCategory !== category
    || after.observation.hidden !== before.observation.hidden
  ) {
    return TRUST_UNAVAILABLE;
  }
  return TRUST_SYNCED;
}

async function syncTrustAfterPriceHiddenWithBudget(
  observationId: string,
  now: number,
  budget: PriceTrustReconciliationBudget,
): Promise<PriceTrustReconciliation> {
  try {
    const found = await findCommunityPriceObservation(observationId);
    if (found.degraded) return TRUST_UNAVAILABLE;
    if (!found.observation || !found.observation.hidden) return TRUST_SYNCED;
    const { venueId, drinkCategory } = found.observation;
    const covering = await priceTrustEventStore().liveEventsCovering(observationId);
    if (covering.degraded) return TRUST_UNAVAILABLE;
    for (const event of covering.events) {
      const written = await priceTrustEventStore().recordUnlock({
        fingerprint: reversalFingerprint(event.evidenceFingerprint),
        venueId: event.venueId,
        category: event.category,
        observationIds: [],
        userIds: [],
        reversalOf: event.id,
        now,
      });
      if (written.failed || !written.event) {
        console.warn(
          `${STORE_TAG} reversal write failed; credit still visible for trust event ${event.id}`,
        );
        return TRUST_UNAVAILABLE;
      }
    }
    const listed = await listCommunityPriceObservations(venueId, drinkCategory);
    if (listed.degraded) return TRUST_UNAVAILABLE;
    const current = await findCommunityPriceObservation(observationId);
    if (current.degraded) return TRUST_UNAVAILABLE;
    if (!current.observation?.hidden) {
      // A restore may have completed after this hide read its live event. The
      // reversal above is now stale, so reconcile from final row visibility.
      if (!consumeReconciliationStep(budget)) return TRUST_UNAVAILABLE;
      return syncTrustAfterPriceRestoredWithBudget(observationId, now, budget);
    }
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return TRUST_SYNCED;
    const live = await priceTrustEventStore().liveEventsFor(venueId, drinkCategory);
    if (live.degraded) return TRUST_UNAVAILABLE;
    if (live.events.length > 0) return TRUST_SYNCED;
    return recordFirstCluster(venueId, drinkCategory, observations, now);
  } catch (error) {
    console.warn(`${STORE_TAG} sync after hide failed`, error);
    return TRUST_UNAVAILABLE;
  }
}

async function syncTrustAfterPriceRestoredWithBudget(
  observationId: string,
  now: number,
  budget: PriceTrustReconciliationBudget,
): Promise<PriceTrustReconciliation> {
  try {
    const found = await findCommunityPriceObservation(observationId);
    if (found.degraded) return TRUST_UNAVAILABLE;
    if (!found.observation || found.observation.hidden) return TRUST_SYNCED;
    const { venueId, drinkCategory } = found.observation;
    const listed = await listCommunityPriceObservations(venueId, drinkCategory);
    if (listed.degraded) return TRUST_UNAVAILABLE;
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return TRUST_SYNCED;
    const live = await priceTrustEventStore().liveEventsFor(venueId, drinkCategory);
    if (live.degraded) return TRUST_UNAVAILABLE;
    if (live.events.length > 0) return TRUST_SYNCED;
    // The row's moderation stamp identifies this transition. Retries and
    // concurrent syncs therefore share one append-only event identity.
    const reversal = await priceTrustEventStore().latestReversalCovering(observationId);
    if (reversal.degraded) return TRUST_UNAVAILABLE;
    if (!reversal.event) return TRUST_SYNCED;
    const restorationKey = reversal.event.id;
    const current = await findCommunityPriceObservation(observationId);
    if (current.degraded) return TRUST_UNAVAILABLE;
    if (current.observation?.hidden) return TRUST_SYNCED;
    const recorded = await recordFirstCluster(
      venueId,
      drinkCategory,
      observations,
      now,
      restorationKey,
    );
    if (recorded.status === "unavailable") return recorded;
    const final = await findCommunityPriceObservation(observationId);
    if (final.degraded) return TRUST_UNAVAILABLE;
    if (final.observation?.hidden) {
      // A hide can land after the visibility check above but before the
      // restored unlock write. Its sync then sees no live event to reverse.
      // Re-read after the write so final hidden state owns the trust result.
      if (!consumeReconciliationStep(budget)) return TRUST_UNAVAILABLE;
      return syncTrustAfterPriceHiddenWithBudget(observationId, now, budget);
    }
    return TRUST_SYNCED;
  } catch (error) {
    console.warn(`${STORE_TAG} sync after restore failed`, error);
    return TRUST_UNAVAILABLE;
  }
}

export async function syncTrustAfterPriceHidden(
  observationId: string,
  now: number = Date.now(),
): Promise<PriceTrustReconciliation> {
  const budget = createReconciliationBudget();
  if (!consumeReconciliationStep(budget)) return TRUST_UNAVAILABLE;
  return syncTrustAfterPriceHiddenWithBudget(observationId, now, budget);
}

export async function syncTrustAfterPriceRestored(
  observationId: string,
  now: number = Date.now(),
): Promise<PriceTrustReconciliation> {
  const budget = createReconciliationBudget();
  if (!consumeReconciliationStep(budget)) return TRUST_UNAVAILABLE;
  return syncTrustAfterPriceRestoredWithBudget(observationId, now, budget);
}

export async function reconcilePriceTrustForObservation(
  observationId: string,
  now: number = Date.now(),
): Promise<PriceTrustObservationReconciliation> {
  const budget = createReconciliationBudget();
  while (consumeReconciliationStep(budget)) {
    const before = await findCommunityPriceObservation(observationId);
    if (before.degraded) return TRUST_UNAVAILABLE;
    if (!before.observation) return TRUST_NOT_FOUND;

    let unavailable = false;
    if (before.observation.hidden) {
      const hidden = await syncTrustAfterPriceHiddenWithBudget(observationId, now, budget);
      unavailable = hidden.status === "unavailable";
    }
    const prepared = await preparePriceTrustAfterWrite(
      before.observation.venueId,
      before.observation.drinkCategory,
      now,
    );
    unavailable ||= prepared.status === "unavailable";

    const proof = await proveCurrentPriceTrustInvariant(
      observationId,
      before.observation.venueId,
      before.observation.drinkCategory,
      now,
    );
    if (proof.status === "not-found") return proof;
    if (proof.status === "unavailable" || unavailable) continue;
    if (prepared.status !== "synced") continue;

    const acknowledged = await acknowledgePreparedPriceTrust(prepared.task);
    if (acknowledged.status === "synced") return TRUST_SYNCED;
  }
  return TRUST_UNAVAILABLE;
}

export async function readPriceTrustImpact(
  userId: string,
): Promise<PriceTrustImpact> {
  try {
    const key = userId.trim();
    if (!key) return { status: "degraded" };
    const profile = await profileStore().getByUserId(key);
    const actor = profile ? `profile:${profile.id}` : "";
    const logged = actor
      ? await countCommunityPriceObservationsForActor(actor)
      : { count: 0, degraded: false };
    if (logged.degraded) return { status: "degraded" };
    const impact = await priceTrustEventStore().readVisibleImpact(key);
    if (impact.degraded) return { status: "degraded" };

    const pairs = new Map<string, { venueId: string; category: DrinkCategory }>();
    for (const event of impact.events) {
      if (event.reversalOf) continue;
      pairs.set(pairKey(event.venueId, event.category), {
        venueId: event.venueId,
        category: event.category,
      });
    }
    const rows = await listCommunityPriceObservationsForPairs(
      [...pairs.values()].map((pair) => ({
        venueId: pair.venueId,
        drinkCategory: pair.category,
      })),
    );
    if (rows.degraded) return { status: "degraded" };
    const byPair = new Map<string, TrustObservation[]>();
    for (const observation of asTrustObservations(rows.observations)) {
      const pair = pairKey(observation.venueId, observation.drinkCategory);
      const held = byPair.get(pair);
      if (held) held.push(observation);
      else byPair.set(pair, [observation]);
    }
    let pricesTrustedNow = 0;
    for (const pair of pairs.keys()) {
      if (categoryIsTrusted(byPair.get(pair) ?? [])) pricesTrustedNow += 1;
    }

    return {
      status: "ready",
      observationsLogged: logged.count,
      pricesTrustedNow,
      lifetimeTrustUnlocks: impact.lifetimeTrustUnlocks,
    };
  } catch (error) {
    console.warn(`${STORE_TAG} impact read failed`, error);
    return { status: "degraded" };
  }
}
