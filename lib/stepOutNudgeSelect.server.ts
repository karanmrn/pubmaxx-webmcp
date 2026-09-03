import "server-only";

// Server-only selection of an owed Step Out payload for one account.
// Priority: Wanted near the night-area patch → open Soft Plan → sourced deal.
// Skip when nothing is owed. Coarse area centre only — never precise location.

import { getNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { nightProfileStore } from "@/lib/nightProfileStore";
import { admin } from "@/lib/storeBackend";
import {
  composeDealEndingNudge,
  composeSoftPlanOpenNudge,
  composeWantedNearbyNudge,
  selectStepOutNudge,
  STEP_OUT_NUDGE_MAX_WALK_MINUTES,
  type StepOutNudgePayload,
} from "@/lib/stepOutNudge";
import { walkMinutes } from "@/lib/tonight";
import { getVenueIndex } from "@/lib/venueIndex";
import type { WantedDTO } from "@/lib/wanted";
import { wantedStore } from "@/lib/wantedStore";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import { isSupabaseConfigured } from "@/lib/supabase";

export type SoftPlanCandidate = { id: string; title: string };

export type DealCandidate = {
  dealTitle: string;
  placeName: string;
  endsAt: string;
  sourceLabel: string;
  venueId?: string;
  lat?: number;
  lng?: number;
};

export type StepOutNudgeSelectDeps = {
  listOpenWanteds: (ownerActor: string) => Promise<WantedDTO[]>;
  nightAreaForAccount: (accountId: string) => Promise<NightAreaSlug | null>;
  venueCoords: (
    venueId: string,
  ) => Promise<{ name: string; lat: number; lng: number } | null>;
  listOpenSoftPlans: (
    accountId: string,
    now: Date,
  ) => Promise<SoftPlanCandidate[]>;
  listTonightDeals: (now: Date) => Promise<DealCandidate[]>;
};

function londonDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isSameLondonDay(iso: string, now: Date): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  return londonDayKey(new Date(ms)) === londonDayKey(now);
}

async function defaultListOpenWanteds(ownerActor: string): Promise<WantedDTO[]> {
  const result = await wantedStore().listOpenForOwner(ownerActor);
  return result.wanteds;
}

async function defaultNightArea(accountId: string): Promise<NightAreaSlug | null> {
  try {
    const profile = await nightProfileStore().get(accountId);
    return profile?.context.nightArea ?? null;
  } catch {
    return null;
  }
}

async function defaultVenueCoords(
  venueId: string,
): Promise<{ name: string; lat: number; lng: number } | null> {
  const index = await getVenueIndex();
  const hit = index.get(venueId);
  if (!hit) return null;
  return { name: hit.name, lat: hit.lat, lng: hit.lng };
}

async function defaultListOpenSoftPlans(
  accountId: string,
  now: Date,
): Promise<SoftPlanCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await admin()
      .from("plans")
      .select("id, title, start_time, status")
      .eq("owner_user_id", accountId)
      .in("status", ["draft", "ready"]);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((row) => {
        const start = typeof row.start_time === "string" ? row.start_time : "";
        return start ? isSameLondonDay(start, now) : true;
      })
      .map((row) => ({
        id: String(row.id),
        title: typeof row.title === "string" ? row.title : "Soft Plan",
      }));
  } catch {
    return [];
  }
}

async function defaultListTonightDeals(now: Date): Promise<DealCandidate[]> {
  try {
    const whatsOn = await loadWhatsOn(
      { window: "tonight" },
      { now: now.getTime(), fetchLive: async () => [] },
    );
    // A read that could not run carries no deals to offer, and it is not a
    // night without any: the nudge falls through rather than naming one.
    if (whatsOn.readStatus === "degraded") return [];
    return whatsOn.rows
      .filter((row) => row.kind === "deal" && row.endsAt && isSameLondonDay(row.endsAt, now))
      .filter((row) => row.confidence === "confirmed" || row.confidence === "listed")
      .map((row) => ({
        dealTitle: row.title,
        placeName: row.placeName,
        endsAt: row.endsAt!,
        sourceLabel: row.source.label,
        venueId: row.venueId,
        lat: row.lat,
        lng: row.lng,
      }));
  } catch {
    return [];
  }
}

export function defaultStepOutNudgeSelectDeps(): StepOutNudgeSelectDeps {
  return {
    listOpenWanteds: defaultListOpenWanteds,
    nightAreaForAccount: defaultNightArea,
    venueCoords: defaultVenueCoords,
    listOpenSoftPlans: defaultListOpenSoftPlans,
    listTonightDeals: defaultListTonightDeals,
  };
}

async function pickWantedNearby(
  deps: StepOutNudgeSelectDeps,
  ownerActor: string,
  accountId: string,
): Promise<StepOutNudgePayload | null> {
  const areaSlug = await deps.nightAreaForAccount(accountId);
  if (!areaSlug) return null;
  const area = getNightArea(areaSlug);
  if (!area) return null;
  const wanteds = await deps.listOpenWanteds(ownerActor);
  let best: StepOutNudgePayload | null = null;
  let bestMinutes = Number.POSITIVE_INFINITY;
  for (const wanted of wanteds) {
    if (wanted.venueKind === "pending" || !wanted.venueId) continue;
    const venue = await deps.venueCoords(wanted.venueId);
    if (!venue) continue;
    const minutes = walkMinutes(area.centre, { lat: venue.lat, lng: venue.lng });
    if (minutes == null || minutes > STEP_OUT_NUDGE_MAX_WALK_MINUTES) continue;
    if (minutes >= bestMinutes) continue;
    const payload = composeWantedNearbyNudge({
      venueName: wanted.venueName || venue.name,
      walkMinutes: minutes,
      venueId: wanted.venueId,
    });
    if (!payload) continue;
    best = payload;
    bestMinutes = minutes;
  }
  return best;
}

/**
 * Resolve the one owed Step Out payload for this account, or null when nothing
 * place-bound is owed (no filler).
 */
export async function selectOwedStepOutNudge(
  ownerActor: string,
  accountId: string,
  now: Date = new Date(),
  deps: StepOutNudgeSelectDeps = defaultStepOutNudgeSelectDeps(),
): Promise<StepOutNudgePayload | null> {
  const wanted = await pickWantedNearby(deps, ownerActor, accountId);

  const softPlans = await deps.listOpenSoftPlans(accountId, now);
  const softPlan = softPlans[0]
    ? composeSoftPlanOpenNudge({ planId: softPlans[0].id })
    : null;

  const areaSlug = await deps.nightAreaForAccount(accountId);
  const area = areaSlug ? getNightArea(areaSlug) : null;
  const deals = await deps.listTonightDeals(now);
  let dealPayload: StepOutNudgePayload | null = null;
  let dealMinutes = Number.POSITIVE_INFINITY;
  for (const deal of deals) {
    let minutes = Number.POSITIVE_INFINITY;
    if (area && deal.lat != null && deal.lng != null) {
      const walk = walkMinutes(area.centre, { lat: deal.lat, lng: deal.lng });
      if (walk != null) minutes = walk;
    }
    if (minutes > dealMinutes) continue;
    const composed = composeDealEndingNudge(deal);
    if (!composed) continue;
    dealPayload = composed;
    dealMinutes = minutes;
  }

  return selectStepOutNudge([wanted, softPlan, dealPayload]);
}

/** Map owner_actor `profile:{uuid}` → auth user id via profiles.user_id. */
export async function accountIdForOwnerActor(
  ownerActor: string,
): Promise<string | null> {
  if (!ownerActor.startsWith("profile:")) return null;
  const profileId = ownerActor.slice("profile:".length);
  if (!profileId) return null;
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await admin()
      .from("profiles")
      .select("user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return typeof data?.user_id === "string" ? data.user_id : null;
  } catch {
    return null;
  }
}
