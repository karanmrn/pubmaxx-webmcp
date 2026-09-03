// The self-owned analytics event set (Wave D · D0). One registry, shared by the
// client beacon (lib/analytics.ts) and the ingest route (app/api/events), so
// both agree on which events exist and which props each may carry.
//
// Privacy-first by construction: no account identifiers and no free text.
// PostHog receives only this sanitized contract, with a stable pseudonymous id
// available solely after analytics consent. Every event is a fixed name and
// its props are a small allow-list of low-cardinality primitives — anything
// else is dropped before it can leave the device or land in the log. This keeps
// the "measurement spine" the other waves draw their success signals from
// honest and PII-free even as new events are added.

import {
  COVERAGE_STATUSES,
  NIGHT_AREA_SLUGS,
  ROUTE_READY_GATE_CODES,
  ROUTE_READY_GATE_VERSION,
} from "@/lib/nightAreas";
import { boroughCode, LONDON_BOROUGH_NAMES } from "@/lib/pintIndex";
import { RSVP_STATUSES } from "@/lib/planInvite";
import { REACTION_KEYS } from "@/lib/reactions";
import { ROUTE_PATTERNS, ROUTE_PATTERN_OTHER } from "@/lib/routePattern";
import { VITAL_METRICS, VITAL_RATINGS, sanitizeVitalTarget } from "@/lib/webVitals";
import type { DrinkCategory } from "@/lib/drinks";

/** Allowed prop keys per event. An empty list means the event carries no props. */
export const ANALYTICS_EVENTS = {
  // R3 cycle metrics rail (carried over from the original Vercel-backed
  // trackEvent; ported onto this self-owned registry so the same closed set
  // of ~10 named events keeps working under the D0 beacon).
  badge_tap: [],
  lane_card_tap: [],
  lane_to_plan: ["source", "stops"],
  cmdk_open: [],
  night_mode_active: [],
  drop_logged: [],
  booking_click: ["tier"],
  whats_on_filter: [],
  // Wave F · F3 — concierge-as-map-home
  concierge_ask: [],
  concierge_result_tap: [],
  tour_complete: ["completed"],
  plan_created: ["count"],
  night_description_submitted: ["area", "daypart"],
  planned_night_status_changed: ["status"],
  planned_night_action: ["type"],
  pub_pal_adopted: ["pal"],
  pub_pal_summoned: ["surface"],
  pub_pal_memory_changed: ["action", "category"],
  discovery_viewed: ["surface", "daypart"],
  plan_invite_sent: ["channel"],
  plan_invite_opened: ["source"],
  // Trusted pint-to-crew handoff. Every prop is fixed-schema and low-cardinality;
  // required-field validation below rejects the whole event on mismatch.
  near_answer_ready: ["source", "resultBand"],
  near_venue_opened: ["source", "positionBand"],
  near_mode_switched: ["mode"],
  desk_answer_served: ["outcome"],
  venue_accepted: ["source", "hasArea", "hasDate", "hasProvenance"],
  planning_handoff_opened: ["from", "to"],
  planning_handoff_preserved: [
    "from",
    "to",
    "venuePreserved",
    "areaPreserved",
    "datePreserved",
    "provenancePreserved",
  ],
  map_search_no_results: [],
  map_search_ran: ["intent", "nationalHits", "nationalStatus"],
  map_area_switched: [],
  map_search_jump: [],
  tonight_result_opened: ["kind", "localityBasis"],
  crew_committed: ["source", "participants", "routeReady"],
  account_claimed: ["source"],
  social_account_connected: ["provider", "connectionType"],
  // PostHog wizard adoption. Auth state and successful writes carry no account,
  // contact, handle, area, or response data. Provider is a fixed button enum.
  sign_in_initiated: ["provider"],
  user_signed_in: [],
  user_signed_out: [],
  message_attach_selected: ["kind"],
  // A device hopped between two accounts it already holds. No props at all: an
  // account id or a handle here would name a person, and which accounts share a
  // device is the most identifying pair this app could record.
  account_switched: [],
  check_in_created: [],
  night_moment_saved: ["kind", "visibility"],
  night_memory_created: ["source"],
  night_story_published: ["contributors", "moments"],
  // Recap page (Cycle 9). Sharing is a return-loop signal; the gate event marks
  // a crew stepping toward the consent flow, never a publish itself.
  recap_shared: ["channel", "planId"],
  recap_share_gate_opened: ["planId"],
  next_night_committed: ["windowDays", "source"],
  draft_recovered: ["kind", "surface"],
  web_vital: ["metric", "value", "rating", "route", "target"],
  guest_plan_participated: ["action"],
  // Wave A
  tonight_screen_view: [],
  tonight_filter_select: ["kind"],
  out_screen_view: [],
  out_filter_select: ["kind"],
  create_fab_action: ["action"],
  // Vibe layer (docs/VIBE_LAYER_SPEC_2026-07-19.md): which mood chip was
  // pressed. The vibe id only — never free text, never location.
  tonight_vibe_select: ["vibe"],
  // Plan-page crew vibe vote (share-loop tally). Same contract: chip id only.
  plan_vibe_vote: ["vibe"],
  event_chip_view: ["kind"],
  // Wave D — sharing is a return-loop signal; alcohol quantity is never
  // represented as progression telemetry.
  poster_shared: ["surface"],
  // PLG Wave 2 physical QR: a drinker landed on /near from /?src=poster.
  // No props — the closed name is the whole signal (no free text, no UTM).
  poster_landing: [],
  // London Capture — reviewed catalogue identifiers and gate codes only.
  district_catalogue_viewed: [],
  district_viewed: ["district", "coverageStatus", "demandWave"],
  district_route_blocked: ["district", "coverageStatus", "demandWave", "reason"],
  district_route_ready_selected: ["district", "coverageStatus", "demandWave"],
  route_ready_gate_failed: ["district", "coverageStatus", "demandWave", "reason", "gateVersion"],
  // Metrics funnel (Wave M) — nights planned/week reuses plan_created (create)
  // and crew_committed (join, source: "shared-plan") from R3/Wave F above; see
  // docs/METRICS_FUNNEL.md for the full computation. The events below are new.
  //
  // Invites per planner — invite_created (host mints a link) and
  // invite_redeemed (a guest actually unlocks collaboration on it) share the
  // invite's own row id, which is an opaque, non-secret database identifier
  // (never the raw invite token/capability) — safe to join on for k-factor.
  invite_created: ["inviteId"],
  invite_redeemed: ["inviteId"],
  // Return rate (daily basis) — one coarse, low-cardinality signal per
  // identity per UTC calendar day (days-since-epoch, deduped client-side
  // before it is ever sent). No timestamp, no session length, no fingerprint.
  activity_pulse: ["dayBucket"],
  // A2HS installs — beforeinstallprompt eligibility, the appinstalled
  // completion event (Android/Chrome), and standalone display-mode at launch
  // as the iOS-compatible proxy for "already installed". No props needed.
  // "platform" registered per the C8 drift note: #313's A2HS surface emits
  // { platform: "android" | "ios-safari" } — without the allow-listed prop the
  // sanitizer would strip it.
  pwa_install_prompt_available: ["platform"],
  pwa_install_completed: ["platform"],
  pwa_standalone_launch: ["platform"],
  // Native shell (Capacitor) — contextual push pre-permission explainer.
  native_push_prompt_enable: [],
  native_push_prompt_later: [],
  // Wave 0.5 loop metrics. These names describe confirmed product outcomes,
  // not page views. Props stay deliberately coarse: no Plan/Memory/Story ids,
  // user content, locations, coordinates, or elapsed-time fingerprints.
  plan_generated: ["stops", "grounded"],
  plan_draft_saved: ["stops", "grounded", "anchored", "routeReady", "source"],
  plan_accepted: ["stops", "grounded", "anchored", "routeReady", "source"],
  plan_saved: ["stops", "grounded"],
  claim_started: ["source"],
  claim_completed: ["source"],
  plan_completed: ["ending"],
  memory_reviewed: ["source"],
  story_published: ["visibility", "contributors", "moments"],
  // Community-price contribution funnel. The whole point is the ratio
  // price_submitted / price_submit_viewed, so `viewed` is emitted once per
  // venue-sheet open from the account-independent entry panel and gives that
  // ratio its denominator. Props stay at the registry's usual bar: the drink
  // category is a closed taxonomy enum and the failure reason a three-value
  // enum - never the venue id, the venue name, the price typed, or the error
  // sentence shown to the drinker.
  price_submit_viewed: ["category"],
  price_submitted: ["category"],
  price_submit_failed: ["category", "reason"],
  price_impact_opened: [],
  contribution_gate: ["step"],
  // Price evidence missions. Surface, reason, optional category, and
  // submit outcome only. No venue, handle, price, or coordinates.
  mission_viewed: ["surface", "reason", "category"],
  mission_opened: ["surface", "reason", "category"],
  mission_dismissed: ["surface", "reason", "category"],
  mission_submitted: ["surface", "reason", "category", "outcome"],
  mission_newly_trusted: ["surface", "reason", "category", "outcome"],
  mission_impact_opened: ["surface"],
  // Press-arrival funnel (the London Pint Index). Three questions, and these
  // events exist to answer exactly those: how many ARRIVED on the Index or one
  // of its dated editions (pint_index_viewed, once per page view), how many
  // REACHED A MAP VIEW of an area from there (pint_index_area_opened is the
  // tap, pint_index_map_reached is the map actually loading with the arrival
  // marker, so an abandoned navigation cannot inflate the reach), and how many
  // CAME BACK (`visit`, plus the existing activity_pulse day rail for the
  // second session; see docs/METRICS_FUNNEL.md).
  //
  // Props stay at the registry's usual bar. `surface` is a two-value enum,
  // `visit` a two-value enum from a consent-gated local marker (no timestamp,
  // no session length, no fingerprint), and `area` a borough code from the
  // closed London list the Index itself is built on - never a coordinate, a
  // postcode, or anything the visitor typed.
  pint_index_viewed: ["surface", "visit"],
  pint_index_area_opened: ["surface", "area"],
  pint_index_map_reached: [],
  // One roll-up event gives Reach a stable denominator in PostHog. Only the
  // explicit loop actions below qualify; route generation, claim steps, and
  // passive opens never do.
  meaningful_core_action: ["action"],
  // Invite loop (a Plan's public /invite/[token] page). Consent-gated, same
  // treatment as the press-arrival and price funnels above: fixed enums and
  // booleans only. No planId, inviteId, guest display name, or invite token
  // ever rides in these props - see docs/METRICS_FUNNEL.md §7 for why the
  // link-copy/rotate events carry no plan identifier at all.
  plan_invite_link_copied: [],
  plan_invite_link_rotated: [],
  invite_page_viewed: ["hasRsvps"],
  invite_rsvp_submitted: ["status", "isUpdate"],
  invite_reaction_toggled: ["reaction", "active"],
  invite_map_opened: [],
  // "Out tonight" beacon (You page toggle). No handle and no area ever ride in
  // these props - only that a crew-only beacon was switched on or off.
  out_tonight_beacon_on: [],
  out_tonight_beacon_off: [],
  // WP7 friend-graph byproduct: a mutual pair formed because both accounts were
  // committed members of the same plan crew. Source is a closed enum; never a
  // handle, plan id, or member id.
  friend_edge_via_crew: ["source"],
  // Landing Wave 0 acquisition CTAs. Closed target enum only — never free text.
  landing_cta_clicked: ["target"],
  // Wanted Wave A — paste → save → fulfil. Closed enums only; never venue
  // names, raw paste text, or source URLs.
  wanted_created: ["venueKind", "hasSourceUrl"],
  wanted_fulfilled: ["venueKind"],
  wanted_promoted: [],
  // A claim landed inside the first hundred and was granted a founding number.
  // It carries NO props on purpose: the number itself is unique to one account,
  // so sending it would put an account identifier in the analytics payload this
  // registry exists to keep out, and even a coarse band narrows the same way.
  // The count of these events is the whole signal.
  founding_grant: [],
  // The share-link add surface (/add/<handle>). Growth's own funnel: the link
  // was opened, a door was taken, an add landed. `surface` and `outcome` are
  // closed enums and nothing else rides here - never the handle on the link,
  // which names one person on both ends of it.
  add_link_viewed: ["surface"],
  add_link_signup_started: ["surface", "outcome"],
  add_link_added: ["surface", "outcome"],
  // Crowd occupancy (R-011). Level and surface only - never a venue id,
  // handle, or coordinate. `state` is the derived now-read, not a stored trust.
  occupancy_reported: ["level", "surface"],
  occupancy_read: ["state"],
  // Open plans (Out L3). placeKind is venue|place. decision is accept|decline.
  // Never a crew id, handle, venue id, or coordinate.
  open_plan_posted: ["placeKind"],
  open_plan_join_requested: [],
  open_plan_join_decided: ["decision"],
  // Out listing card. Closed source enum only - never an event id, venue id,
  // or coordinate.
  out_card_opened: ["source"],
  // Creator-list acquisition loop. Counts alone answer whether public lists
  // reach their detail and Map handoffs. Handles, list names and venue ids are
  // deliberately absent because each can identify a person or place.
  creator_list_viewed: [],
  creator_list_map_opened: [],
  creator_list_plan_started: [],
  creator_list_followed: [],
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const PLANNING_SOURCES = [
  "near",
  "map-search",
  "tonight",
  "pal",
  "direct-plan",
  "mobile-route-preview",
] as const;
export type PlanningSource = (typeof PLANNING_SOURCES)[number];

export const ACCEPTANCE_SOURCES = ["near", "map-search", "tonight", "pal"] as const;
export type AcceptanceSource = (typeof ACCEPTANCE_SOURCES)[number];

export const HANDOFF_SOURCES = [
  "near",
  "map-search",
  "tonight",
  "pal",
  "mobile-route-preview",
] as const;
export type HandoffSource = (typeof HANDOFF_SOURCES)[number];

export const TONIGHT_LOCALITY_BASES = [
  "live-location",
  "remembered-patch",
  "remembered-borough",
  "london-default",
] as const;
export type TonightLocalityBasis = (typeof TONIGHT_LOCALITY_BASES)[number];

export const NEAR_ANSWER_SOURCES = [
  "location",
  "remembered-area",
  "picked-area",
  "default-area",
] as const;
export type NearAnswerSource = (typeof NEAR_ANSWER_SOURCES)[number];

export type TrustedHandoffAnalyticsPropsByEvent = {
  near_answer_ready: {
    source: NearAnswerSource;
    resultBand: "0" | "1-3" | "4+";
  };
  near_venue_opened: {
    source: NearAnswerSource;
    positionBand: "1" | "2-3" | "4+";
  };
  near_mode_switched: { mode: "pint" | "desk" };
  desk_answer_served: { outcome: "answer" | "thin" };
  venue_accepted: {
    source: AcceptanceSource;
    hasArea: boolean;
    hasDate: boolean;
    hasProvenance: boolean;
  };
  planning_handoff_opened: { from: HandoffSource; to: "map" | "plan" };
  planning_handoff_preserved: {
    from: HandoffSource;
    to: "map" | "plan";
    venuePreserved: boolean;
    areaPreserved: boolean;
    datePreserved: boolean;
    provenancePreserved: boolean;
  };
  map_search_no_results: Record<never, never>;
  map_search_ran: {
    intent: "borough" | "city" | "area" | "uk_place" | "venue" | "unknown";
    nationalHits: number;
    nationalStatus: "ready" | "degraded" | "skipped";
  };
  tonight_result_opened: {
    kind: "sport" | "quiz" | "deal" | "music" | "gig" | "event" | "other";
    localityBasis: TonightLocalityBasis;
  };
  plan_draft_saved: {
    stops: 1;
    grounded: true;
    anchored: true;
    routeReady: false;
    source: PlanningSource;
  };
  plan_accepted: {
    stops: 3;
    grounded: true;
    anchored: boolean;
    routeReady: true;
    source: PlanningSource;
  };
  crew_committed: {
    source: "shared-plan";
    participants: number;
    routeReady: boolean;
  };
};

/**
 * The drink taxonomy as the price funnel may report it. Spelled out here rather
 * than imported as a value so the registry keeps its zero-runtime-dependency
 * shape (it is loaded by both the beacon and the ingest route); the constraint
 * on `completeDrinkTaxonomy` makes a drift from lib/drinks.ts in either
 * direction - an unknown value or a missing category - a type error rather
 * than a silent mismatch.
 */
function completeDrinkTaxonomy<const T extends readonly DrinkCategory[]>(
  categories: T & ([DrinkCategory] extends [T[number]] ? unknown : never),
): T {
  return categories;
}

export const PRICE_SUBMIT_CATEGORIES = completeDrinkTaxonomy([
  "beer", "wine", "whisky", "gin", "vodka", "rum", "cocktail", "shot",
  "alcohol-free", "soft-drink", "coffee", "other",
]);

/**
 * Why a submission did not land. `invalid` is the client-side envelope check
 * (the same validator the route runs), `rejected` a non-2xx answer from the
 * route, `offline` a transport failure. Deliberately three coarse buckets - the
 * error sentence the drinker sees is free text and never leaves the device.
 */
export const PRICE_SUBMIT_FAILURE_REASONS = ["invalid", "rejected", "offline"] as const;
export type PriceSubmitFailureReason = (typeof PRICE_SUBMIT_FAILURE_REASONS)[number];

export const MISSION_SURFACES = ["near", "map", "profile"] as const;
export type MissionSurface = (typeof MISSION_SURFACES)[number];

export const MISSION_REASONS = ["provisional", "stale", "missing"] as const;
export type MissionReason = (typeof MISSION_REASONS)[number];

export const MISSION_OUTCOMES = ["logged", "trusted", "needs_check"] as const;
export type MissionOutcome = (typeof MISSION_OUTCOMES)[number];

/**
 * Which Pint Index page the arrival happened on: the live index, or one of its
 * dated monthly editions. Kept apart because a press link to a frozen edition
 * and a link to the live page convert differently, and we want to know which.
 */
export const PINT_INDEX_SURFACES = ["index", "archive"] as const;
export type PintIndexSurface = (typeof PINT_INDEX_SURFACES)[number];

/** Landing hero / final CTA destinations (docs/plans/LANDING_ACQUISITION.md W6). */
export const LANDING_CTA_TARGETS = ["map", "near", "plan", "pal"] as const;
export type LandingCtaTarget = (typeof LANDING_CTA_TARGETS)[number];

/** First time this browser has opened a Pint Index page, or a return. */
export const PINT_INDEX_VISITS = ["first", "repeat"] as const;
export type PintIndexVisit = (typeof PINT_INDEX_VISITS)[number];

/** The closed set of area codes a Pint Index arrival tap may report. */
export const PINT_INDEX_AREA_CODES = LONDON_BOROUGH_NAMES.map(boroughCode);

export const WEEKLY_MEANINGFUL_CORE_ACTIONS = [
  "plan_accepted",
  "plan_saved",
  "plan_completed",
  "memory_reviewed",
  "story_published",
] as const satisfies readonly AnalyticsEventName[];

export type WeeklyMeaningfulCoreAction = (typeof WEEKLY_MEANINGFUL_CORE_ACTIONS)[number];

export type AnalyticsProps = Record<string, string | number | boolean>;

/** A validated, ready-to-send event. */
export type AnalyticsEvent = {
  name: AnalyticsEventName;
  props: AnalyticsProps;
};

const MAX_STRING_LEN = 40;

const CONTRIBUTION_GATE_STEPS = [
  "sign_in_required",
  "onboarding_required",
] as const;

const SAFE_STRING_VALUES = new Set([
  // fixed product surfaces and provenance
  "landing", "home", "map", "tonight", "tomorrow", "weekend", "plan", "you", "pal", "borough", "city", "crawl", "recap",
  "moment", "price",
  "shared-plan", "plan-link", "crew-reinvite", "completed_plan", "plan-crew",
  "near", "map-search", "direct-plan", "mobile-route-preview",
  "location", "remembered-area", "picked-area", "default-area", "0", "1", "1-3", "2-3", "4+",
  "pint", "desk", "answer", "thin",
  "live-location", "remembered-patch", "remembered-borough", "london-default", "other",
  "tonight-lane", "tonight-vibes", "landing-why",
  "whats-on-quiz", "whats-on-sport", "whats-on-deal", "whats-on-music",
  // fixed actions, states, providers, and fallbacks
  "copy", "native", "whatsapp", "sms", "x", "instagram", "tiktok", "oauth", "manual",
  "draft", "ready", "active", "ending", "completed", "abandoned",
  "degraded", "skipped", "venue", "uk_place", "unknown",
  "arrived", "skipped", "swapped", "food_preview", "get_home_preview", "keep_going_preview",
  "food", "get_home", "keep_going", "hound", "raven", "fox",
  "create", "edit", "delete", "approve", "reject", "preference", "correction", "outcome",
  // reviewed domain enums
  "daytime", "after_work", "evening", "late_night", "morning", "afternoon", "night",
  "coffee", "af", "chill",
  "bender", "lit", "quiet", "cheeky", "match", "quiz", "date",
  "sport", "deal", "music", "gig",
  "photo", "pint_drop", "pint-drop", "event", "venue", "quote", "person", "side_quest",
  "photos", "camera", "document",
  "private", "unlisted", "public", "friends", "legacy", "anonymous",
  "direct", "site", "search",
  // A2HS platform values (#313): fixed enum, no UA strings
  "android", "ios-safari", "standalone", "unsupported",
  "CLS", "FCP", "INP", "LCP", "TTFB", "good", "needs-improvement", "poor",
  // Wave 0.5 fixed loop vocabulary.
  "auth", "inline_recap", "full_recap",
  "plan_accepted", "plan_saved", "plan_completed", "memory_reviewed", "story_published",
  // Wanted Wave A venue kinds (closed enum on wanted_created / wanted_fulfilled).
  "curated", "uk_base", "pending",
  // Share-link add funnel: the one surface, the two doors, the three outcomes.
  "add-link", "signin", "added", "failed", "unavailable",
  // Crowd occupancy: the three buttons, the four now-read states, the two
  // surfaces that may report. `degraded` and `pal` already sit above.
  "empty", "some-seats", "full", "fresh", "stale", "none", "venue-sheet",
  "place", "accept", "decline",
  // Out card sources. Closed set; never a free-text publisher or venue name.
  "ticketmaster", "skiddle", "common",
  // Community-price funnel vocabulary: the drink taxonomy and the three
  // failure buckets.
  ...PRICE_SUBMIT_CATEGORIES,
  ...PRICE_SUBMIT_FAILURE_REASONS,
  ...MISSION_SURFACES,
  ...MISSION_REASONS,
  ...MISSION_OUTCOMES,
  ...CONTRIBUTION_GATE_STEPS,
  // Press-arrival vocabulary: the two Pint Index surfaces, the two visit
  // kinds, and the London borough codes an arrival tap may name.
  ...PINT_INDEX_SURFACES,
  ...PINT_INDEX_VISITS,
  ...PINT_INDEX_AREA_CODES,
  ...NIGHT_AREA_SLUGS,
  ...COVERAGE_STATUSES,
  ...ROUTE_READY_GATE_CODES,
  // Invite loop vocabulary: RSVP status and the closed reaction set.
  ...RSVP_STATUSES,
  ...REACTION_KEYS,
]);

const DISTRICT_EVENT_PROP_VALUES = {
  district: NIGHT_AREA_SLUGS,
  coverageStatus: COVERAGE_STATUSES,
  demandWave: [0, 1, 2, 3],
  reason: ROUTE_READY_GATE_CODES,
  gateVersion: [ROUTE_READY_GATE_VERSION],
} as const;

function isAllowedDistrictEventProp(name: AnalyticsEventName, key: string, value: string | number | boolean): boolean {
  if (!name.startsWith("district_") && name !== "route_ready_gate_failed") return true;
  const allowed = DISTRICT_EVENT_PROP_VALUES[key as keyof typeof DISTRICT_EVENT_PROP_VALUES];
  return !allowed || (allowed as readonly (string | number | boolean)[]).includes(value);
}

const TRUSTED_HANDOFF_REQUIRED_KEYS = {
  near_answer_ready: ["source", "resultBand"],
  near_venue_opened: ["source", "positionBand"],
  near_mode_switched: ["mode"],
  desk_answer_served: ["outcome"],
  venue_accepted: ["source", "hasArea", "hasDate", "hasProvenance"],
  planning_handoff_opened: ["from", "to"],
  planning_handoff_preserved: [
    "from",
    "to",
    "venuePreserved",
    "areaPreserved",
    "datePreserved",
    "provenancePreserved",
  ],
  tonight_result_opened: ["kind", "localityBasis"],
  plan_draft_saved: ["stops", "grounded", "anchored", "routeReady", "source"],
  plan_accepted: ["stops", "grounded", "anchored", "routeReady", "source"],
  crew_committed: ["source", "participants", "routeReady"],
  message_attach_selected: ["kind"],
  open_plan_posted: ["placeKind"],
  open_plan_join_decided: ["decision"],
  meaningful_core_action: ["action"],
  // The funnel is a ratio, so a step with no drink category would be an
  // uncountable event rather than a partial one - fail closed like the rest.
  price_submit_viewed: ["category"],
  price_submitted: ["category"],
  price_submit_failed: ["category", "reason"],
  contribution_gate: ["step"],
  mission_viewed: ["surface", "reason"],
  mission_opened: ["surface", "reason"],
  mission_dismissed: ["surface", "reason"],
  mission_submitted: ["surface", "reason", "outcome"],
  mission_newly_trusted: ["surface", "reason", "outcome"],
  mission_impact_opened: ["surface"],
  // An arrival with no surface, or a tap with no area, is an uncountable step
  // in a funnel whose whole value is the ratio between its steps.
  pint_index_viewed: ["surface", "visit"],
  pint_index_area_opened: ["surface", "area"],
  // Field RUM: a vital is meaningless without which metric, its value, rating,
  // and the route it happened on. `target` (attribution selector) is optional.
  web_vital: ["metric", "value", "rating", "route"],
  // Invite loop: a page view with no RSVP context, an RSVP with no status, or
  // a reaction toggle with no reaction/direction is an uncountable step in a
  // funnel whose whole value is the ratio between its steps - fail closed.
  invite_page_viewed: ["hasRsvps"],
  invite_rsvp_submitted: ["status", "isUpdate"],
  invite_reaction_toggled: ["reaction", "active"],
  landing_cta_clicked: ["target"],
} as const satisfies Partial<Record<AnalyticsEventName, readonly string[]>>;

function includesValue(values: readonly string[], value: string | number | boolean): boolean {
  return typeof value === "string" && values.includes(value);
}

function isAllowedVerifiedOutcomeProp(
  name: "plan_draft_saved" | "plan_accepted" | "crew_committed",
  key: string,
  value: string | number | boolean,
): boolean {
  if (name === "plan_draft_saved") {
    if (key === "stops") return value === 1;
    if (key === "grounded" || key === "anchored") return value === true;
    if (key === "routeReady") return value === false;
    return key === "source" && includesValue(PLANNING_SOURCES, value);
  }
  if (name === "plan_accepted") {
    if (key === "stops") return value === 3;
    if (key === "grounded" || key === "routeReady") return value === true;
    if (key === "anchored") return typeof value === "boolean";
    return key === "source" && includesValue(PLANNING_SOURCES, value);
  }
  if (key === "source") return value === "shared-plan";
  if (key === "participants") {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
  }
  return key === "routeReady" && typeof value === "boolean";
}

function isAllowedTrustedHandoffEventProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name === "plan_draft_saved" || name === "plan_accepted" || name === "crew_committed") {
    return isAllowedVerifiedOutcomeProp(name, key, value);
  }
  switch (name) {
    case "near_answer_ready":
      return key === "source"
        ? includesValue(NEAR_ANSWER_SOURCES, value)
        : key === "resultBand" && includesValue(["0", "1-3", "4+"], value);
    case "near_venue_opened":
      return key === "source"
        ? includesValue(NEAR_ANSWER_SOURCES, value)
        : key === "positionBand" && includesValue(["1", "2-3", "4+"], value);
    case "near_mode_switched":
      return key === "mode" && includesValue(["pint", "desk"], value);
    case "desk_answer_served":
      return key === "outcome" && includesValue(["answer", "thin"], value);
    case "venue_accepted":
      return key === "source"
        ? includesValue(ACCEPTANCE_SOURCES, value)
        : ["hasArea", "hasDate", "hasProvenance"].includes(key) && typeof value === "boolean";
    case "planning_handoff_opened":
      return key === "from"
        ? includesValue(HANDOFF_SOURCES, value)
        : key === "to" && includesValue(["map", "plan"], value);
    case "planning_handoff_preserved":
      if (key === "from") return includesValue(HANDOFF_SOURCES, value);
      if (key === "to") return includesValue(["map", "plan"], value);
      return ["venuePreserved", "areaPreserved", "datePreserved", "provenancePreserved"].includes(key)
        && typeof value === "boolean";
    case "tonight_result_opened":
      return key === "kind"
        ? includesValue(["sport", "quiz", "deal", "music", "gig", "event", "other"], value)
        : key === "localityBasis" && includesValue(TONIGHT_LOCALITY_BASES, value);
    default:
      return true;
  }
}

function isAllowedLoopEventProp(name: AnalyticsEventName, key: string, value: string | number | boolean): boolean {
  if (["plan_generated", "plan_saved"].includes(name)) {
    if (key === "stops") return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
    if (key === "grounded") return typeof value === "boolean";
  }
  if ((name === "claim_started" || name === "claim_completed") && key === "source") return value === "auth";
  if (name === "plan_completed" && key === "ending") {
    return typeof value === "string" && ["food", "get_home", "keep_going"].includes(value);
  }
  if (name === "memory_reviewed" && key === "source") {
    return typeof value === "string" && ["inline_recap", "full_recap"].includes(value);
  }
  if (name === "story_published") {
    if (key === "visibility") return typeof value === "string" && ["public", "unlisted"].includes(value);
    if (key === "contributors" || key === "moments") {
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
    }
  }
  if (name === "meaningful_core_action" && key === "action") {
    return typeof value === "string" && (WEEKLY_MEANINGFUL_CORE_ACTIONS as readonly string[]).includes(value);
  }
  return true;
}

// UUID-shaped values (e.g. a plan invite's own row id) are the one exception
// to the fixed-enum string allowlist below: they are opaque, non-secret,
// server-generated identifiers — never free text, never the raw invite
// token/capability — so a format check is enough to keep them PII-free.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// A vital's `route` may only be one of the app's known route templates (or the
// "/other" fallback) — never a raw path, so a venue id/slug/handle can never
// ride in. `target` must survive the same selector sanitiser the beacon applied.
const KNOWN_ROUTE_PATTERNS = new Set<string>([...ROUTE_PATTERNS, ROUTE_PATTERN_OTHER]);

function isKnownRoutePattern(value: unknown): value is string {
  return typeof value === "string" && KNOWN_ROUTE_PATTERNS.has(value);
}

function isSafeVitalTarget(value: unknown): value is string {
  return typeof value === "string" && sanitizeVitalTarget(value) === value;
}

/** Per-prop-key validators that replace the generic enum check for that key. */
const CUSTOM_PROP_VALIDATORS: Partial<Record<string, (value: unknown) => value is string | number | boolean>> = {
  inviteId: isUuidLike,
  route: isKnownRoutePattern,
  // `target` is shared by web_vital (selector) and landing_cta_clicked (CTA enum).
  // Those checks live in isAllowedVitalProp / isAllowedLandingCtaProp below.
};

/** web_vital metric/rating/value/target strictness (route uses CUSTOM_PROP_VALIDATORS). */
function isAllowedVitalProp(name: AnalyticsEventName, key: string, value: string | number | boolean): boolean {
  if (name !== "web_vital") return true;
  if (key === "metric") return includesValue(VITAL_METRICS, value);
  if (key === "rating") return includesValue(VITAL_RATINGS, value);
  if (key === "value") return typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (key === "target") return isSafeVitalTarget(value);
  return true;
}

function isAllowedLandingCtaProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name !== "landing_cta_clicked" || key !== "target") return true;
  return includesValue(LANDING_CTA_TARGETS, value);
}

/**
 * Community-price funnel strictness. `category` shares its key name with
 * pub_pal_memory_changed, whose vocabulary is a different closed set, so the
 * check is scoped to these three events rather than to the key.
 */
function isAllowedPriceFunnelProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (!name.startsWith("price_submit")) return true;
  if (key === "category") return includesValue(PRICE_SUBMIT_CATEGORIES, value);
  if (key === "reason") return includesValue(PRICE_SUBMIT_FAILURE_REASONS, value);
  return true;
}

function isAllowedMissionProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (!name.startsWith("mission_")) return true;
  if (key === "surface") return includesValue(MISSION_SURFACES, value);
  if (key === "reason") return includesValue(MISSION_REASONS, value);
  if (key === "category") return includesValue(PRICE_SUBMIT_CATEGORIES, value);
  if (key === "outcome") return includesValue(MISSION_OUTCOMES, value);
  return true;
}

function isAllowedContributionGateProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name !== "contribution_gate" || key !== "step") return true;
  return includesValue(CONTRIBUTION_GATE_STEPS, value);
}

/**
 * Press-arrival strictness. `surface`, `visit` and `area` each have their own
 * closed vocabulary, and `area` shares no key name with another event, so the
 * check is scoped to the three arrival events rather than to the keys.
 */
function isAllowedPintIndexArrivalProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (!name.startsWith("pint_index_")) return true;
  if (key === "surface") return includesValue(PINT_INDEX_SURFACES, value);
  if (key === "visit") return includesValue(PINT_INDEX_VISITS, value);
  if (key === "area") return includesValue(PINT_INDEX_AREA_CODES, value);
  return true;
}

/**
 * Invite loop strictness. `status` and `reaction` each have their own closed
 * vocabulary and share no key name with another event, so the check is
 * scoped to the two invite events rather than to the keys.
 */
function isAllowedInviteLoopProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name === "invite_rsvp_submitted") {
    if (key === "status") return includesValue(RSVP_STATUSES, value);
    if (key === "isUpdate") return typeof value === "boolean";
  }
  if (name === "invite_reaction_toggled") {
    if (key === "reaction") return includesValue(REACTION_KEYS, value);
    if (key === "active") return typeof value === "boolean";
  }
  return true;
}

function isAllowedMessageAttachProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name !== "message_attach_selected" || key !== "kind") return true;
  return includesValue(["photos", "camera", "document"], value);
}

function isAllowedOpenPlanProp(
  name: AnalyticsEventName,
  key: string,
  value: string | number | boolean,
): boolean {
  if (name === "open_plan_posted" && key === "placeKind") {
    return includesValue(["venue", "place"], value);
  }
  if (name === "open_plan_join_decided" && key === "decision") {
    return includesValue(["accept", "decline"], value);
  }
  return true;
}

export function isKnownEvent(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/**
 * A prop value is safe only when it is a low-cardinality primitive: a short
 * string with no "@" (a cheap guard against emails / handles slipping in), a
 * finite number, or a boolean. Everything else is rejected.
 */
function isSafeValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") {
    return value.length > 0
      && value.length <= MAX_STRING_LEN
      && !value.includes("@")
      && SAFE_STRING_VALUES.has(value);
  }
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 600_000;
  return typeof value === "boolean";
}

/**
 * Validate + narrow an event to exactly what the registry permits. Unknown
 * event names return null; unknown or unsafe prop keys/values are dropped
 * silently so a bad prop never blocks a legitimate event. The result is safe to
 * both send from the client and persist server-side.
 */
export function sanitizeEvent(
  name: string,
  props?: Record<string, unknown> | null,
): AnalyticsEvent | null {
  if (!isKnownEvent(name)) return null;
  const allowedKeys = ANALYTICS_EVENTS[name] as readonly string[];
  const out: AnalyticsProps = {};
  if (props && typeof props === "object") {
    for (const key of allowedKeys) {
      const value = (props as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const customValidator = CUSTOM_PROP_VALIDATORS[key];
      // `target` is shared by web_vital (a sanitized selector, never a fixed
      // enum member) and landing_cta_clicked (a closed enum). Its real
      // strictness is fully delegated to isAllowedVitalProp /
      // isAllowedLandingCtaProp below, so it must bypass the generic
      // isSafeValue enum gate the same way a CUSTOM_PROP_VALIDATORS entry
      // would - otherwise a legitimate selector like "main>img.hero" never
      // reaches those checks at all.
      const valid = name === "sign_in_initiated" && key === "provider"
        ? value === "google" || value === "apple" || value === "email"
        : key === "target" && (name === "web_vital" || name === "landing_cta_clicked")
          ? typeof value === "string"
            && isAllowedVitalProp(name, key, value)
            && isAllowedLandingCtaProp(name, key, value)
          : customValidator
            ? customValidator(value)
            : isSafeValue(value)
              && isAllowedDistrictEventProp(name, key, value)
              && isAllowedLoopEventProp(name, key, value)
              && isAllowedTrustedHandoffEventProp(name, key, value)
              && isAllowedVitalProp(name, key, value)
              && isAllowedPriceFunnelProp(name, key, value)
              && isAllowedMissionProp(name, key, value)
              && isAllowedContributionGateProp(name, key, value)
              && isAllowedPintIndexArrivalProp(name, key, value)
              && isAllowedInviteLoopProp(name, key, value)
              && isAllowedMessageAttachProp(name, key, value)
              && isAllowedLandingCtaProp(name, key, value)
              && isAllowedOpenPlanProp(name, key, value);
      if (valid) out[key] = value as string | number | boolean;
    }
  }
  // Fixed-schema outcomes and handoff discriminators fail closed. Unknown keys
  // are still dropped, but a missing or invalid required key rejects the whole
  // event rather than producing an ambiguous partial metric.
  const requiredKeys = TRUSTED_HANDOFF_REQUIRED_KEYS[name as keyof typeof TRUSTED_HANDOFF_REQUIRED_KEYS];
  if (requiredKeys?.some((key) => out[key] === undefined)) return null;
  return { name, props: out };
}
