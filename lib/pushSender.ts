// Server-side push fan-out. Resolves target tokens from the push-token registry
// (lib/pushTokenStore.ts), hands them to the selected provider
// (lib/pushProvider.ts), summarises the per-token results, and prunes any token
// the provider reports invalid (APNs 410 / BadDeviceToken).
//
// ── IDENTITY LIMITATION (read before adding a plan-scoped send) ──────────────
// Push tokens can register PRE-AUTH after contextual permission approval, so a
// token row carries NO user/plan identity. Plan-scoped targeting - "notify
// only this Plan's crew" — is therefore impossible today. Two consequences:
//   • Broadcast (night-signal "went live") CAN send: every token is a valid
//     target, so broadcastNightSignalLive() fans out to store.list() wholesale.
//   • Plan-scoped events (proposal decision, get-in change) CANNOT target, so
//     resolvePlanTokens() returns [] and notifyPlanUpdate() is a plumbed no-op
//     behind the PLAN-SCOPED SEAM below. It activates unchanged the day tokens
//     gain identity — wire resolvePlanTokens() to a token→plan lookup then.
// Sending to ALL tokens for a plan-scoped event would be a privacy leak (crew A
// gets crew B's Plan updates), so that path stays closed until identity exists.

import { DAY_MS } from "@/lib/dayMs";
import { isLimited } from "@/lib/pintDrops";
import {
  PerTokenResult,
  PushPayload,
  selectPushProvider,
} from "@/lib/pushProvider";
import {
  pushTokenStore,
  type PushPlatform,
  type PushTokenInput,
} from "@/lib/pushTokenStore";
import {
  CHEAP_PINT_PING_THREAD_ID,
  type CheapPintPingPayload,
} from "@/lib/cheapPintPing";
import {
  STEP_OUT_NUDGE_THREAD_ID,
  type StepOutNudgePayload,
} from "@/lib/stepOutNudge";

/** A signal freshly promoted into the live snapshot — the broadcast payload. */
export type NightSignalHighlight = {
  id: string;
  /** Notification title, e.g. the venue / area name. */
  title: string;
  /** Notification body, e.g. the claim text. */
  body: string;
  /** Night-signal entity id, for deep-linking (rides APNs custom data). */
  entityId: string;
};

/** Reason a plan changed — decode target once tokens gain identity. */
export type PlanUpdateReason = "proposal_accepted" | "proposal_rejected" | "getin_changed";

/** Plan-scoped notification payload. Plumbed now, dispatched once tokens carry
 *  identity (see PLAN-SCOPED SEAM). */
export type PlanUpdatePayload = {
  planId: string;
  reason: PlanUpdateReason;
  title: string;
  body: string;
};

/** Outcome of one fan-out, aggregated across tokens. */
export type PushDispatchSummary = {
  /** Tokens the send targeted (0 when no provider work was needed). */
  targeted: number;
  sent: number;
  skipped: number;
  /** Invalid tokens the provider reported — these were pruned from the store. */
  pruned: number;
  errors: number;
  results: PerTokenResult[];
};

const EMPTY_SUMMARY: PushDispatchSummary = {
  targeted: 0,
  sent: 0,
  skipped: 0,
  pruned: 0,
  errors: 0,
  results: [],
};

/**
 * Core send: deliver `payload` to `tokens`, prune any the provider marks
 * invalid, and summarise. Never throws for a per-token failure (the provider
 * returns those as results); a provider-level throw is caught and surfaced as
 * an all-error summary so callers (fire-and-forget) never see a rejection.
 */
async function dispatch(
  targets: readonly PushTokenInput[],
  payload: PushPayload,
): Promise<PushDispatchSummary> {
  if (targets.length === 0) return { ...EMPTY_SUMMARY };
  const platforms: readonly PushPlatform[] = ["ios", "android", "web"];
  const groups = new Map<PushPlatform, Array<{ target: PushTokenInput; index: number }>>();
  targets.forEach((target, index) => {
    const group = groups.get(target.platform) ?? [];
    group.push({ target, index });
    groups.set(target.platform, group);
  });
  const results = new Array<PerTokenResult>(targets.length);

  await Promise.all(platforms.map(async (platform) => {
    const group = groups.get(platform);
    if (!group) return;
    const provider = selectPushProvider(platform);
    let platformResults: PerTokenResult[];
    try {
      platformResults = await provider.send(group.map(({ target }) => target.token), payload);
    } catch (err) {
      console.error(
        `[pushSender] ${platform} provider send failed for ${group.length} token(s):`,
        err instanceof Error ? err.message : String(err),
      );
      platformResults = group.map(({ target }) => ({
        token: target.token,
        status: "error",
        reason: `${platform}_provider_threw`,
      }));
    }
    group.forEach(({ target, index }, groupIndex) => {
      results[index] = platformResults[groupIndex] ?? {
        token: target.token,
        status: "error",
        reason: `${platform}_provider_missing_result`,
      };
    });
  }));

  const invalid = results.filter((r) => r.status === "invalid");
  if (invalid.length > 0) {
    const store = pushTokenStore();
    await Promise.allSettled(invalid.map((r) => store.delete(r.token)));
  }

  return {
    targeted: targets.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    pruned: invalid.length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
}

/**
 * Broadcast newly-live night signals to EVERY registered device. This is the
 * one launch event that can send today: a night signal going live is public,
 * so wholesale delivery to store.list() is correct (not a privacy leak).
 */
export async function broadcastNightSignalLive(
  highlights: readonly NightSignalHighlight[],
): Promise<PushDispatchSummary> {
  if (highlights.length === 0) return { ...EMPTY_SUMMARY };
  const targets = await pushTokenStore().list();
  const lead = highlights[0];
  const extra = highlights.length - 1;
  const payload: PushPayload = {
    title: highlights.length === 1 ? "New tonight" : `${highlights.length} updates for tonight`,
    body: extra > 0 ? `${lead.body} + ${extra} more` : lead.body,
    threadId: "night-signals",
    data: {
      kind: "night_signal_live",
      url: "/tonight",
      entityId: lead.entityId,
      signalId: lead.id,
      count: String(highlights.length),
    },
  };
  return dispatch(targets, payload);
}

export type DailyBriefHighlight = {
  /** Source-backed weather verdict from lib/todayBrief.ts. */
  weatherLine: string;
  /** Highest-ranked, current What's-On pick from lib/todayBrief.ts. */
  topPickTitle: string;
  topPickPlace: string;
};

/** Manual installed-web daily brief. It is a city-wide public broadcast and
 * therefore does not pretend to have identity targeting before Wave 1.4. Only
 * explicit web subscriptions are selected; native APNs behaviour is unchanged. */
export async function broadcastDailyBrief(
  highlight: DailyBriefHighlight,
): Promise<PushDispatchSummary> {
  const registrations = await pushTokenStore().list();
  const targets = registrations.filter((registration) => registration.platform === "web");
  return dispatch(targets, {
    title: "Today in London",
    body: `${highlight.weatherLine} Tonight: ${highlight.topPickTitle} at ${highlight.topPickPlace}.`,
    threadId: "daily-brief",
    data: { kind: "daily_brief", url: "/today" },
  });
}

/** Deliver one place-bound Step Out nudge to a single web subscription. */
export async function sendStepOutNudge(
  subscriptionToken: string,
  payload: StepOutNudgePayload,
): Promise<PushDispatchSummary> {
  if (!subscriptionToken) return { ...EMPTY_SUMMARY };
  return dispatch([{ token: subscriptionToken, platform: "web" }], {
    title: payload.title,
    body: payload.body,
    threadId: STEP_OUT_NUDGE_THREAD_ID,
    data: {
      kind: "step_out_nudge",
      nudgeKind: payload.kind,
      url: payload.url,
      ...(payload.sourceLabel ? { sourceLabel: payload.sourceLabel } : {}),
    },
  });
}

export async function sendCheapPintPing(
  subscriptionToken: string,
  payload: CheapPintPingPayload,
): Promise<PushDispatchSummary> {
  if (!subscriptionToken) return { ...EMPTY_SUMMARY };
  return dispatch([{ token: subscriptionToken, platform: "web" }], {
    title: payload.title,
    body: payload.body,
    threadId: CHEAP_PINT_PING_THREAD_ID,
    data: {
      kind: "cheap_pint_ping",
      url: payload.url,
      venueId: payload.venueId,
      priceLabel: payload.priceLabel,
    },
  });
}

// In-process dedup — a CHEAP FIRST CHECK ONLY, never the authority. It is
// per-instance state (empty on every cold start and on every fresh serverless
// instance), so on its own a single snapshot version would broadcast once PER
// INSTANCE = duplicate pushes to every device. The durable claim below is the
// authority; this Set only saves a redundant durable round trip on the hot path
// within one warm instance.
const broadcastedVersions = new Set<string>();

// The durable claim: a budget-of-1 rate-limit bucket keyed on the snapshot
// version — the same atomic mechanism every rate-limited route uses
// (lib/pintDrops.isLimited → Supabase RPC, with an in-memory fallback when
// Supabase is unconfigured). The first caller across ALL instances spends the
// single unit and broadcasts; every other caller is "limited" and skips, so a
// version broadcasts at most once globally. The window is long because a
// snapshot version (its generatedAt) is monotonic and never recurs — the claim
// only has to outlive the deploy generation, not forever.
const BROADCAST_CLAIM_WINDOW_MS = 7 * DAY_MS;

async function claimNightSignalBroadcast(version: string): Promise<boolean> {
  const key = `night-signal-broadcast:${version}`;
  // isLimited records the attempt atomically and returns false for the FIRST
  // unit (the winning claim), true once the budget of 1 is spent. Same key for
  // the local + durable arg, exactly like the push-tokens route.
  return !(await isLimited(key, key, 1, BROADCAST_CLAIM_WINDOW_MS));
}

/**
 * Fire the night-signal broadcast at most once per snapshot version, GLOBALLY.
 * Safe to call on every read of the night-signals route: the durable claim
 * (not the per-instance Set) guarantees a single broadcast even across cold
 * starts and concurrent instances.
 *
 * AT-MOST-ONCE: the claim is consumed BEFORE the send. If the send then fails
 * (provider outage), the claim is deliberately NOT released — a dropped
 * broadcast is acceptable; a duplicate to every device is not.
 */
export async function maybeBroadcastNightSignalLive(
  version: string,
  highlights: readonly NightSignalHighlight[],
): Promise<PushDispatchSummary> {
  if (!version || broadcastedVersions.has(version)) return { ...EMPTY_SUMMARY };
  const won = await claimNightSignalBroadcast(version);
  // Mark the in-process Set regardless of outcome so a LOSING instance also
  // short-circuits its own future reads cheaply.
  broadcastedVersions.add(version);
  if (!won) return { ...EMPTY_SUMMARY };
  return broadcastNightSignalLive(highlights);
}

/** Test-only: forget which snapshot versions THIS INSTANCE has seen. Does not
 *  clear the durable claim (that is the whole point — it survives an instance
 *  reset), so a post-reset call for the same version still loses the claim. */
export function __resetNightSignalBroadcasts(): void {
  broadcastedVersions.clear();
}

// ── PLAN-SCOPED SEAM (dormant until tokens gain identity) ────────────────────

/**
 * Resolve the device tokens for a Plan's crew. Returns [] today because tokens
 * carry no identity — see the IDENTITY LIMITATION at the top of this file.
 * TODO(push-identity): once a token row can be linked to a member/plan, look up
 * this plan's tokens here; notifyPlanUpdate() then delivers with no other
 * change. Do NOT fall back to store.list() — that would leak Plan A's updates
 * to Plan B's devices.
 */
async function resolvePlanTokens(planId: string): Promise<PushTokenInput[]> {
  void planId; // Dormant: no token→plan link exists yet (see IDENTITY LIMITATION).
  return [];
}

/**
 * Notify a Plan's crew that the Plan changed (a proposal decision applied, or
 * get-in estimates shifted). Plumbed end-to-end now; dispatches nothing until
 * resolvePlanTokens() can target (see PLAN-SCOPED SEAM). Fire-and-forget at the
 * call site — it never throws.
 */
export async function notifyPlanUpdate(
  payload: PlanUpdatePayload,
): Promise<PushDispatchSummary> {
  const targets = await resolvePlanTokens(payload.planId);
  if (targets.length === 0) return { ...EMPTY_SUMMARY };
  return dispatch(targets, {
    title: payload.title,
    body: payload.body,
    threadId: `plan:${payload.planId}`,
    data: {
      kind: "plan_update",
      url: `/plan/${encodeURIComponent(payload.planId)}`,
      planId: payload.planId,
      reason: payload.reason,
    },
  });
}

/**
 * Fire a push send without blocking the caller. Swallows every failure — a push
 * is best-effort (a dropped notification just means no notification). Use at
 * request handlers so the HTTP response never waits on delivery.
 */
export function fireAndForgetPush(run: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(run)
    .catch((err) => {
      console.error(
        "[pushSender] fire-and-forget push failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
}
