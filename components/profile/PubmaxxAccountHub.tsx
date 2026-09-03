"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import FoundersWallLink from "@/components/founding/FoundersWallLink";
import FoundingMemberCard from "@/components/founding/FoundingMemberCard";
import {
  analyticsConsentDecision,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
  trackEvent,
} from "@/lib/analytics";
import type { AnalyticsConsentDecision } from "@/lib/analyticsIdentity";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  AuthActionSessionError,
  authedActionFetch,
} from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { emitIdentityHandleChanged, syncDeviceHandle } from "@/lib/identityClient";
import PrivateIdentityEditor from "@/components/identity/PrivateIdentityEditor";
import SetAccountPassword from "@/components/auth/SetAccountPassword";
import NightMemoryStudio from "@/components/profile/NightMemoryStudio";
import StepOutNudgePref from "@/components/profile/StepOutNudgePref";
import FindYourLot from "@/components/social/FindYourLot";
import ReferralFollowBack from "@/components/social/ReferralFollowBack";
import StarterPacks from "@/components/social/StarterPacks";
import {
  REFERRAL_RECOGNITION_NOTE,
  referralMarkDetail,
  referralMilestoneReached,
} from "@/lib/referrals";
import type { ReferralPrivateStatus } from "@/lib/referralStore";
import {
  cleanNightProfileInput,
  DEFAULT_NIGHT_PROFILE_INPUT,
  nightProfileInput,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";
import {
  confirmedNightProfileMerge,
  nightProfileMergeState,
  readDeviceNightProfile,
  subscribeDeviceNightProfile,
  mirrorAccountNightProfileToDevice,
  writeDeviceNightProfile,
  type NightProfileMergeChoice,
  type NightProfileMergeState,
} from "@/lib/nightProfileClient";
import {
  confirmedPlanRecapClaim,
  planRecapClaimMergeState,
  type PlanRecapClaimChoice,
  type PlanRecapClaimMergeState,
} from "@/lib/planRecapClaim";
import {
  listPendingPlanRecaps,
  resolvePendingPlanRecap,
  subscribeAnyPendingPlanRecap,
  type PendingPlanRecap,
} from "@/lib/planRecap";
import {
  PLAN_HTTP_ONLY_SESSION,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { listEnabledCities, type CityId } from "@/lib/cities";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

// Web Share support never changes within a page lifetime, so no updates arrive.
const subscribeToNothing = () => () => {};

const DAYPART_LABELS: Record<NightProfileInput["context"]["daypart"], string> = {
  daytime: "Daytime",
  after_work: "After work",
  evening: "Evening",
  late_night: "Late night",
  get_home: "Get home",
};

export function DeviceNightProfileReadout({
  profile,
}: {
  profile: NightProfileInput;
}): React.JSX.Element {
  const city =
    listEnabledCities().find((entry) => entry.id === profile.cityId)?.displayName
    ?? profile.cityId;
  const patch = profile.context.nightArea
    ? getNightAreasForCity(profile.cityId).find(
        (area) => area.slug === profile.context.nightArea,
      )?.name ?? profile.context.nightArea
    : "No preference";
  const budget = profile.context.budget.charAt(0).toUpperCase() + profile.context.budget.slice(1);

  return (
    <section className="accountHubDeviceNightProfile" aria-labelledby="device-night-profile-title">
      <p className="profileSectionKicker">Night Profile</p>
      <h3 id="device-night-profile-title">Saved on this device</h3>
      <p className="accountHubNightProfile">
        {city} · {patch} · {DAYPART_LABELS[profile.context.daypart]} · {budget} budget
        {profile.context.zeroProof ? " · zero-proof preferred" : ""}
      </p>
      <p>Sign in to edit this on your account and sync it across devices.</p>
    </section>
  );
}

export function NightProfileControls({
  profile,
  disabled = false,
  saveLabel,
  onChange,
  onSave,
}: {
  profile: NightProfileInput;
  disabled?: boolean;
  saveLabel: string;
  onChange: (profile: NightProfileInput) => void;
  onSave?: () => void;
}): React.JSX.Element {
  const areas = getNightAreasForCity(profile.cityId);
  const update = (next: NightProfileInput) => {
    const clean = cleanNightProfileInput(next);
    if (clean) onChange(clean);
  };
  const updateContext = (patch: Partial<NightProfileInput["context"]>) => {
    update({ ...profile, context: { ...profile.context, ...patch } });
  };

  return (
    <section className="accountHubNightProfileEditor" aria-labelledby="night-profile-title">
      <div>
        <p className="profileSectionKicker">Night Profile</p>
        <h3 id="night-profile-title">How you like to go out.</h3>
        <p>Used to shape editable plans. Precise location and voice transcripts are never saved here.</p>
      </div>
      <div className="accountHubNightProfileGrid">
        <label>City<select disabled={disabled} value={profile.cityId} onChange={(event) => {
          const cityId = event.target.value as CityId;
          const firstArea = getNightAreasForCity(cityId)[0]?.slug ?? null;
          update({ ...profile, cityId, context: { ...profile.context, nightArea: firstArea } });
        }}>{listEnabledCities().map((city) => <option key={city.id} value={city.id}>{city.displayName}</option>)}</select></label>
        <label>Your patch<select disabled={disabled || areas.length === 0} value={profile.context.nightArea ?? ""} onChange={(event) => updateContext({ nightArea: event.target.value ? event.target.value as NightProfileInput["context"]["nightArea"] : null })}><option value="">No preference</option>{areas.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}</select></label>
        <label>Time<select disabled={disabled} value={profile.context.daypart} onChange={(event) => updateContext({ daypart: event.target.value as NightProfileInput["context"]["daypart"] })}><option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option><option value="get_home">Get home</option></select></label>
        <label>Group<select disabled={disabled} value={profile.context.partyType} onChange={(event) => updateContext({ partyType: event.target.value as NightProfileInput["context"]["partyType"] })}><option value="solo">Solo</option><option value="friends">Friends</option><option value="work">Work</option></select></label>
        <label>People<input disabled={disabled} type="number" min="1" max="30" value={profile.context.groupSize ?? ""} placeholder="Any" onChange={(event) => updateContext({ groupSize: event.target.value ? Math.max(1, Math.min(30, Number(event.target.value))) : null })} /></label>
        <label>Budget<select disabled={disabled} value={profile.context.budget} onChange={(event) => updateContext({ budget: event.target.value as NightProfileInput["context"]["budget"] })}><option value="value">Value</option><option value="standard">Standard</option><option value="treat">Treat</option></select></label>
        <label>Max per person<select disabled={disabled} value={profile.context.budgetLimitPence ?? ""} onChange={(event) => updateContext({ budgetLimitPence: event.target.value ? Number(event.target.value) : null })}><option value="">No cap</option><option value="2000">£20</option><option value="3000">£30</option><option value="5000">£50</option><option value="10000">£100</option></select></label>
        <label>Drinks<select disabled={disabled} value={profile.context.zeroProof ? "zero-proof" : "any"} onChange={(event) => updateContext({ zeroProof: event.target.value === "zero-proof" })}><option value="any">Any drinks</option><option value="zero-proof">Prefer alcohol-free</option></select></label>
        <label>Voice<select disabled={disabled} value={profile.voicePreference} onChange={(event) => update({ ...profile, voicePreference: event.target.value as NightProfileInput["voicePreference"] })}><option value="off">Off</option><option value="tts">Read replies aloud</option><option value="ptt">Push to talk</option></select></label>
        <label>Briefings<select disabled={disabled} value={profile.briefingPreferences.muteAll ? "muted" : "on"} onChange={(event) => update({ ...profile, briefingPreferences: { ...profile.briefingPreferences, muteAll: event.target.value === "muted" } })}><option value="on">On</option><option value="muted">Muted</option></select></label>
      </div>
      {onSave ? <button className="accountHubNightProfileSave" type="button" disabled={disabled} onClick={onSave}>{saveLabel}</button> : <p className="accountHubNightProfileSaved" role="status">{saveLabel}</p>}
    </section>
  );
}

export function ReferralInviteCard({
  status,
  busy,
  link,
  notice,
  shareSupported,
  onInvite,
  onCopy,
  onShare,
}: {
  status: ReferralPrivateStatus | null;
  busy: boolean;
  link: string | null;
  notice: string;
  shareSupported: boolean;
  onInvite: () => void;
  onCopy: () => void;
  onShare: () => void;
}): React.JSX.Element {
  const qualified = status?.qualifiedCount ?? 0;
  const referralLabel = qualified === 1 ? "qualified referral" : "qualified referrals";
  // The mark is recognition, so it is printed and never branched on: no surface
  // reads it to decide whether anything runs (`lib/referrals.ts` owns the law).
  const mark = status?.mark ?? null;
  return (
    <div className="accountHubReferral">
      <h3>Invite a mate</h3>
      <p>
        A referral counts after your mate signs up and logs their first accepted
        contribution.
      </p>
      {status ? (
        <p className="accountHubReferralProgress">
          {qualified} {referralLabel}.{" "}
          {status.nextMilestone
            ? `Next milestone: ${status.nextMilestone}.`
            : "All three milestones recorded."}
        </p>
      ) : null}
      {mark ? (
        <p
          className="accountHubReferralMark"
          title={referralMarkDetail(referralMilestoneReached(qualified)) ?? undefined}
        >
          {mark}
        </p>
      ) : null}
      <small>{REFERRAL_RECOGNITION_NOTE}</small>
      {!link ? (
        <button type="button" disabled={busy} onClick={onInvite}>
          {busy ? "Getting your link…" : "Invite a mate"}
        </button>
      ) : (
        <>
          <label className="accountHubReferralLink">
            Your invite link
            <input type="url" readOnly value={link} onFocus={(event) => event.target.select()} />
          </label>
          <div className="accountHubActions">
            <button type="button" onClick={onCopy}>Copy link</button>
            {shareSupported ? (
              <button type="button" onClick={onShare}>Share…</button>
            ) : null}
          </div>
        </>
      )}
      {notice ? (
        <small className="accountHubReferralNotice" role="status">{notice}</small>
      ) : null}
    </div>
  );
}

function AccountHandleEditor({
  auth,
  identityResolved,
}: {
  auth: AccountAuthSnapshot;
  identityResolved: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const active = useRef(true);

  useEffect(() => {
    if (!identityResolved) return;
    active.current = true;
    const controller = new AbortController();
    void accountBoundFetch(
      auth,
      "/api/identity/handle/current",
      { signal: controller.signal },
    ).then(async (response) => {
      const body = await response.json().catch(() => null) as
        | { handle?: string | null; error?: string }
        | null;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(errorMessageFrom(body, "Your handle could not be loaded."));
        return;
      }
      const owned = body?.handle ?? null;
      setCurrentHandle(owned);
      setHandle(owned ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("Your handle could not be loaded.");
      }
    });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [auth, identityResolved]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    // First claim is AccountOnboarding only (handle + date of birth together).
    // A handle-only claim here left accounts stuck on onboarding_required.
    if (!currentHandle) return;
    setMessage("");
    try {
      const response = await accountBoundFetch(
        auth,
        "/api/identity/handle/rename",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle }),
        },
      );
      const body = await response.json().catch(() => ({})) as {
        handle?: string;
        error?: string;
      };
      if (!active.current) return;
      if (!response.ok || !body.handle) {
        setMessage(errorMessageFrom(body, "That handle is unavailable."));
        return;
      }
      syncDeviceHandle(localStorage, body.handle);
      emitIdentityHandleChanged({ ownerId: auth.userId, handle: body.handle });
      router.push(`/u/${encodeURIComponent(body.handle)}`);
    } catch {
      if (active.current) setMessage("That handle could not be saved.");
    }
  }

  if (!identityResolved) return null;

  if (!currentHandle) {
    return (
      <div>
        <h3>Claim your @handle</h3>
        <p>
          Finish the setup dialog that asks for your public handle and date of
          birth. Claiming a handle alone is not enough to contribute.
        </p>
        {message ? <small role="status">{message}</small> : null}
      </div>
    );
  }

  return (
    <form onSubmit={rename}>
      <h3>Your @handle</h3>
      <input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        pattern="[A-Za-z0-9_]{3,30}"
        placeholder="night_owl"
        required
      />
      <button type="submit">Rename handle</button>
      <small>Renames are limited to once every 30 days. Old links keep working.</small>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

export default function PubmaxxAccountHub() {
  const { accountRevision, user, loading, session, identityResolved } = useAuth();
  const viewerSession = useViewerSession();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const accountAuth = useMemo(
    () => captureAccountAuth(user?.id ?? null, session),
    [session, user?.id],
  );
  const [accountNightProfile, setAccountNightProfile] = useState<NightProfile | null>(null);
  const [nightProfileLoaded, setNightProfileLoaded] = useState(false);
  const [nightProfileError, setNightProfileError] = useState(false);
  // Bumping re-runs the signed-in account loads: the silent post-sign-in retry
  // and the visible Try again affordance both go through here.
  const [accountLoadNonce, setAccountLoadNonce] = useState(0);
  const nightProfileAutoRetried = useRef(false);
  const nightProfileOwnerRef = useRef<string | null>(null);
  const [deviceNightProfile, setDeviceNightProfile] = useState<NightProfileInput | null>(null);
  const [nightProfileDraft, setNightProfileDraft] = useState<NightProfileInput | null>(null);
  const [mergeDeferred, setMergeDeferred] = useState(false);
  const [devicePlanRecaps, setDevicePlanRecaps] = useState<PendingPlanRecap[]>([]);
  const [memoryCompletionIds, setMemoryCompletionIds] = useState<string[]>([]);
  const [planRecapMergeLoaded, setPlanRecapMergeLoaded] = useState(false);
  const [planRecapMergeDeferred, setPlanRecapMergeDeferred] = useState(false);
  const [message, setMessage] = useState("");
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsentDecision | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralPrivateStatus | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralNotice, setReferralNotice] = useState("");
  const [referralStateRevision, setReferralStateRevision] = useState(accountRevision);
  const accountRevisionRef = useRef(accountRevision);

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  const shareSupported = useSyncExternalStore(
    subscribeToNothing,
    () => typeof navigator.share === "function",
    () => false,
  );

  useEffect(() => {
    let cancelled = false;
    const decision = analyticsConsentDecision();
    void Promise.resolve().then(() => {
      if (!cancelled) setAnalyticsConsentState(decision);
    });
    const unsubscribe = subscribeAnalyticsConsent(() => {
      if (!cancelled) setAnalyticsConsentState(analyticsConsentDecision());
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function updateAnalyticsConsent(granted: boolean) {
    setAnalyticsConsent(granted);
    setAnalyticsConsentState(granted ? "granted" : "denied");
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      setReferralStateRevision(accountRevision);
      setReferralStatus(null);
      setReferralLink(null);
      setReferralBusy(false);
      setReferralNotice("");
    });
  }, [accountRevision]);

  // Undecided: the full choice card. Decided: the card collapses to a
  // one-line status with a small affordance to reverse it (defect 6).
  const analyticsControls = (
    <div id="analytics-settings">
      <h3>Optional usage analytics</h3>
      {analyticsConsent === null ? (
        <>
          <p>Help improve journeys with a persistent device ID, standard browser details and allow-listed product events. This is optional and can be withdrawn here.</p>
          <div className="accountHubActions">
            <button type="button" onClick={() => updateAnalyticsConsent(true)}>Allow</button>
            <button type="button" onClick={() => updateAnalyticsConsent(false)}>No thanks</button>
          </div>
        </>
      ) : (
        <p className="accountHubConsentStatus" role="status">
          {analyticsConsent === "granted"
            ? "Usage analytics on."
            : "Usage analytics off."}{" "}
          <button
            type="button"
            className="accountHubConsentChange"
            onClick={() => updateAnalyticsConsent(analyticsConsent !== "granted")}
          >
            {analyticsConsent === "granted" ? "Withdraw" : "Allow"}
          </button>
        </p>
      )}
    </div>
  );

  useEffect(() => {
    if (!user) return;
    // A fresh account gets a fresh retry budget; a nonce bump (retry) keeps
    // the spent one so a dead backend cannot loop silent refetches.
    if (nightProfileOwnerRef.current !== user.id) {
      nightProfileOwnerRef.current = user.id;
      nightProfileAutoRetried.current = false;
    }
    const controller = new AbortController();
    const requestRevision = accountRevision;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setNightProfileLoaded(false);
        setNightProfileError(false);
        setAccountNightProfile(null);
        setMergeDeferred(false);
        setPlanRecapMergeLoaded(false);
        setPlanRecapMergeDeferred(false);
        setMemoryCompletionIds([]);
      }
    });
    void Promise.allSettled([
      authedActionFetch("/api/me/night-profile", { signal: controller.signal }),
      socialFriendsLaunchEnabled
        ? authedActionFetch("/api/referrals/status", { signal: controller.signal })
        : Promise.resolve(null),
      authedActionFetch("/api/me/pending-plan-recaps", { signal: controller.signal }),
    ]).then(async ([nightProfileResult, referralsResult, pendingRecapResult]) => {
      if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
      const nightProfile = nightProfileResult.status === "fulfilled"
        ? nightProfileResult.value
        : null;
      const referrals = referralsResult.status === "fulfilled"
        ? referralsResult.value
        : null;
      const pendingRecaps = pendingRecapResult.status === "fulfilled"
        ? pendingRecapResult.value
        : null;
      if (nightProfile?.ok) {
        const body = await nightProfile.json().catch(() => null) as
          | { profile?: NightProfile | null }
          | null;
        if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
        const profile = body?.profile ?? null;
        setAccountNightProfile(profile);
        setNightProfileDraft(profile ? nightProfileInput(profile) : DEFAULT_NIGHT_PROFILE_INPUT);
        const mirrored = mirrorAccountNightProfileToDevice(profile);
        if (mirrored) setDeviceNightProfile(mirrored);
        setNightProfileError(false);
      } else if (!nightProfileAutoRetried.current) {
        // Right after sign-in the first authed read can race session
        // establishment and 401. That is transient: retry once, quietly,
        // before showing anything. A dead error card here was defect 2.
        nightProfileAutoRetried.current = true;
        window.setTimeout(() => {
          if (!controller.signal.aborted && accountRevisionRef.current === requestRevision) {
            setAccountLoadNonce((n) => n + 1);
          }
        }, 1_200);
      } else {
        setNightProfileError(true);
      }
      if (referrals?.ok) {
        const status = await referrals.json().catch(() => null) as
          | ReferralPrivateStatus
          | null;
        if (status && accountRevisionRef.current === requestRevision) setReferralStatus(status);
      }
      if (pendingRecaps?.ok) {
        const body = await pendingRecaps.json().catch(() => null) as {
          memoryCompletionIds?: string[];
        } | null;
        if (accountRevisionRef.current === requestRevision) {
          setMemoryCompletionIds(body?.memoryCompletionIds ?? []);
        }
      }
      if (!controller.signal.aborted && accountRevisionRef.current === requestRevision) {
        // A failed Night Profile read never counts as loaded: loaded gates the
        // merge prompt and account save, which need the real account row.
        if (nightProfile?.ok) setNightProfileLoaded(true);
        setPlanRecapMergeLoaded(true);
      }
    });
    return () => controller.abort();
  }, [accountLoadNonce, accountRevision, socialFriendsLaunchEnabled, user]);

  useEffect(() => {
    const refresh = () => setDeviceNightProfile(readDeviceNightProfile());
    queueMicrotask(refresh);
    return subscribeDeviceNightProfile(refresh);
  }, [user]);

  useEffect(() => {
    const refresh = () => setDevicePlanRecaps(listPendingPlanRecaps());
    queueMicrotask(refresh);
    return subscribeAnyPendingPlanRecap(refresh);
  }, [user]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("socialConnection");
    if (query.get("status") === "connected" && (provider === "x" || provider === "instagram" || provider === "tiktok")) {
      trackEvent("social_account_connected", { provider, connectionType: "oauth" });
    }
  }, []);

  async function confirmProfileMerge(
    state: Exclude<NightProfileMergeState, { kind: "none" }>,
    choice: NightProfileMergeChoice,
  ) {
    const confirmed = confirmedNightProfileMerge(state, choice);
    if (!confirmed.writesAccount) {
      if (state.kind === "conflict") {
        writeDeviceNightProfile(nightProfileInput(state.account), undefined, "account");
        setDeviceNightProfile(nightProfileInput(state.account));
        setNightProfileDraft(nightProfileInput(state.account));
      } else {
        setMergeDeferred(true);
      }
      setMessage("Your account preferences were left unchanged.");
      return;
    }
    const response = await authedActionFetch("/api/me/night-profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: confirmed.profile,
        expectedUpdatedAt: confirmed.expectedUpdatedAt,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      profile?: NightProfile;
      error?: string;
      details?: { currentProfile?: NightProfile | null };
    };
    if (!response.ok || !body.profile) {
      if (response.status === 409 && body.details?.currentProfile !== undefined) {
        setAccountNightProfile(body.details.currentProfile);
      }
      setMessage(errorMessageFrom(body, "Your Night Profile could not be merged."));
      return;
    }
    setAccountNightProfile(body.profile);
    setNightProfileDraft(nightProfileInput(body.profile));
    writeDeviceNightProfile(nightProfileInput(body.profile), undefined, "account");
    setDeviceNightProfile(nightProfileInput(body.profile));
    setMessage("Your device preferences are now on your account.");
  }

  async function confirmPlanRecapClaim(
    state: Exclude<PlanRecapClaimMergeState, { kind: "none" }>,
    choice: PlanRecapClaimChoice,
  ) {
    const confirmed = confirmedPlanRecapClaim(state, choice);
    if (!confirmed.writesAccount) {
      setPlanRecapMergeDeferred(true);
      setMessage("Your private Memories were left unchanged. The recap stays on this device.");
      return;
    }
    const items: Array<{ recap: PendingPlanRecap; memberToken: string }> = [];
    for (const recap of confirmed.recaps) {
      let memberToken = "";
      try {
        const capability = await restorePlanCapability(recap.planId);
        if (capability?.token) memberToken = capability.token;
      } catch {
        memberToken = "";
      }
      if (!memberToken) {
        setMessage(
          "Open the Plan in this browser before bringing the recap. Your local draft is safe.",
        );
        return;
      }
      items.push({
        recap,
        memberToken: memberToken === PLAN_HTTP_ONLY_SESSION ? PLAN_HTTP_ONLY_SESSION : memberToken,
      });
    }
    const response = await authedActionFetch("/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", choice: "bring-device", items }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      memories?: Array<{ memory?: { id: string; planCompletionId?: string | null } }>;
      error?: string;
    };
    if (!response.ok) {
      setMessage(errorMessageFrom(body, "Your private recap could not be brought onto your account."));
      return;
    }
    const nextIds = new Set(memoryCompletionIds);
    for (const entry of body.memories ?? []) {
      const completionId = entry.memory?.planCompletionId;
      if (completionId) nextIds.add(completionId);
    }
    for (const recap of confirmed.recaps) {
      resolvePendingPlanRecap(recap, "saved");
    }
    setMemoryCompletionIds([...nextIds]);
    setDevicePlanRecaps(listPendingPlanRecaps());
    setMessage(
      (body.memories?.length ?? 0) > 1
        ? "Your device recaps are now private Memories. Nothing was published."
        : "Your device recap is now a private Memory. Nothing was published.",
    );
  }

  async function saveAccountNightProfile() {
    if (!nightProfileDraft || !nightProfileLoaded) return;
    const response = await authedActionFetch("/api/me/night-profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: nightProfileDraft,
        expectedUpdatedAt: accountNightProfile?.updatedAt ?? null,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      profile?: NightProfile;
      error?: string;
      details?: { currentProfile?: NightProfile | null };
    };
    if (!response.ok || !body.profile) {
      if (response.status === 409 && body.details?.currentProfile) {
        setAccountNightProfile(body.details.currentProfile);
        setNightProfileDraft(nightProfileInput(body.details.currentProfile));
      }
      setMessage(errorMessageFrom(body, "Your Night Profile could not be saved."));
      return;
    }
    const input = nightProfileInput(body.profile);
    setAccountNightProfile(body.profile);
    setNightProfileDraft(input);
    writeDeviceNightProfile(input, undefined, "account");
    setDeviceNightProfile(input);
    setMessage("Night Profile saved to your account.");
  }

  // Fetch the personal invite link and show it in the card. Sharing and
  // copying are separate buttons: navigator.share needs the user's tap to
  // still count as activation, so it must run synchronously in its own click
  // handler, never after this fetch's await (iOS rejects that silently).
  async function inviteMate() {
    if (referralBusy) return;
    setReferralBusy(true);
    setReferralNotice("");
    const requestRevision = accountRevision;
    try {
      const response = await authedActionFetch("/api/referrals/invite-link", {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        error?: unknown;
      } | null;
      if (!response.ok || !body?.url) {
        setReferralNotice(errorMessageFrom(body, "Your invite link could not be made. Try again."));
        return;
      }
      if (accountRevisionRef.current !== requestRevision) return;
      setReferralLink(body.url);
      setReferralNotice("Your invite link is ready. Copy it or share it.");
    } catch (error) {
      if (accountRevisionRef.current !== requestRevision) return;
      setReferralNotice(
        error instanceof AuthActionSessionError
          ? error.message
          : "Your invite link could not be made. Try again.",
      );
    } finally {
      if (accountRevisionRef.current === requestRevision) setReferralBusy(false);
    }
  }

  const visibleReferralLink = referralStateRevision === accountRevision ? referralLink : null;
  const visibleReferralStatus = referralStateRevision === accountRevision ? referralStatus : null;
  const visibleReferralBusy = referralStateRevision === accountRevision && referralBusy;
  const visibleReferralNotice = referralStateRevision === accountRevision ? referralNotice : "";

  async function copyInviteLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setReferralNotice("Invite link copied.");
    } catch {
      setReferralNotice("Copy failed. Select the link above and copy it.");
    }
  }

  function shareInviteLink() {
    if (!referralLink || typeof navigator.share !== "function") return;
    // Called synchronously from the tap so the share sheet keeps its user
    // activation. The promise is observed afterwards; a dismissed sheet is
    // not an error.
    navigator
      .share({
        title: "PUBMAXX",
        text: "Listed pub prices name and link their publisher when recorded and say when none is recorded.",
        url: referralLink,
      })
      .then(() => setReferralNotice("Invite link shared."))
      .catch((error: unknown) => {
        if ((error as { name?: unknown })?.name === "AbortError") return;
        setReferralNotice("Sharing did not open. Copy the link instead.");
      });
  }

  if (loading || viewerSession.unresolved) return <section className="accountHub" aria-busy="true"><p>Loading your account…</p></section>;
  if (viewerSession.signedOut) return (
    <section className="accountHub">
      <p className="profileSectionKicker">Your PUBMAXX</p>
      <h2>Sign in to save your nights</h2>
      <div className="accountHubSignIn">
        <p>Sign in to claim a handle, connect profiles, and keep private Night Memories. Your device profile is only brought to an account after you review it.</p>
        <SignInButton />
      </div>
      {deviceNightProfile ? <DeviceNightProfileReadout profile={deviceNightProfile} /> : null}
      <div className="accountHubGrid">
        <StepOutNudgePref />
        {analyticsControls}
      </div>
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
  if (!user) return <section className="accountHub" aria-busy="true"><p>Loading your account…</p></section>;

  const mergeState = mergeDeferred || !nightProfileLoaded
    ? ({ kind: "none" } as const)
    : nightProfileMergeState(deviceNightProfile, accountNightProfile);

  const planRecapMergeState = planRecapMergeDeferred || !planRecapMergeLoaded
    ? ({ kind: "none" } as const)
    : planRecapClaimMergeState(devicePlanRecaps, memoryCompletionIds);

  return (
    <section className="accountHub" aria-labelledby="account-hub-title">
      <p className="profileSectionKicker">Your PUBMAXX</p><h2 id="account-hub-title">Identity, connections and memories.</h2>
      {socialFriendsLaunchEnabled ? <ReferralFollowBack /> : null}
      {/* The account hub is where a freshly onboarded drinker lands, and the
          packs gate themselves on following fewer than three accounts, so this
          is the "after onboarding" beat without putting a form in front of
          arrival. */}
      {socialFriendsLaunchEnabled ? <StarterPacks /> : null}
      {socialFriendsLaunchEnabled ? <FindYourLot /> : null}
      {mergeState.kind !== "none" ? (
        <div className="accountHubMerge" role="group" aria-labelledby="night-profile-merge-title">
          <h3 id="night-profile-merge-title">Bring your Night Profile?</h3>
          <p>
            {mergeState.kind === "conflict"
              ? "This device and your account have different night preferences. Nothing changes until you choose."
              : "This device has night preferences that are not on your account yet. Nothing changes until you choose."}
          </p>
          <div className="accountHubActions">
            <button type="button" onClick={() => void confirmProfileMerge(mergeState, "bring-device")}>Bring this device</button>
            <button type="button" onClick={() => void confirmProfileMerge(mergeState, "keep-account")}>
              {mergeState.kind === "conflict" ? "Keep account preferences" : "Keep only on this device"}
            </button>
          </div>
        </div>
      ) : accountNightProfile ? (
        <p className="accountHubNightProfile">Night Profile synced · {accountNightProfile.context.budget} budget{accountNightProfile.context.zeroProof ? " · zero-proof preferred" : ""}</p>
      ) : null}
      {planRecapMergeState.kind !== "none" ? (
        <div className="accountHubMerge" role="group" aria-labelledby="plan-recap-merge-title">
          <h3 id="plan-recap-merge-title">Bring tonight&rsquo;s private recap?</h3>
          <p>
            {planRecapMergeState.recaps.length === 1
              ? "This device has a finished-night recap that is not on your account yet. Bringing it saves one private Memory. Nothing is published."
              : `This device has ${planRecapMergeState.recaps.length} finished-night recaps that are not on your account yet. Bringing them saves private Memories. Nothing is published.`}
          </p>
          <div className="accountHubActions">
            <button type="button" onClick={() => void confirmPlanRecapClaim(planRecapMergeState, "bring-device")}>
              Bring this device
            </button>
            <button type="button" onClick={() => void confirmPlanRecapClaim(planRecapMergeState, "keep-device")}>
              Keep only on this device
            </button>
          </div>
        </div>
      ) : null}
      {nightProfileError ? (
        <div className="accountHubMerge accountHubNightProfileError" role="status">
          <p>Your account Night Profile could not be loaded.</p>
          <div className="accountHubActions">
            <button
              type="button"
              onClick={() => {
                setNightProfileError(false);
                setAccountLoadNonce((nonce) => nonce + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}
      <NightProfileControls
        profile={nightProfileDraft ?? DEFAULT_NIGHT_PROFILE_INPUT}
        disabled={!nightProfileLoaded}
        saveLabel={
          nightProfileLoaded
            ? "Save Night Profile"
            : nightProfileError
              ? "Night Profile not loaded"
              : "Loading Night Profile…"
        }
        onChange={setNightProfileDraft}
        onSave={() => void saveAccountNightProfile()}
      />
      <div className="accountHubGrid">
        {accountAuth ? (
          <AccountHandleEditor
            key={accountAuth.userId}
            auth={accountAuth}
            identityResolved={identityResolved}
          />
        ) : (
          <div>
            <h3>Your @handle</h3>
            <p>Sign in again to change your handle.</p>
            <SignInButton />
          </div>
        )}
        <FoundingMemberCard />
        {/* Beside the card, never inside it: the CARD is for a founding member
            alone, and the WALL is a public list anybody may read. */}
        <div className="accountHubFoundersWall">
          <h3>The first hundred</h3>
          <FoundersWallLink />
        </div>
        {socialFriendsLaunchEnabled ? (
          <ReferralInviteCard
            status={visibleReferralStatus}
            busy={visibleReferralBusy}
            link={visibleReferralLink}
            notice={visibleReferralNotice}
            shareSupported={shareSupported}
            onInvite={() => void inviteMate()}
            onCopy={() => void copyInviteLink()}
            onShare={shareInviteLink}
          />
        ) : null}
      </div>
      <section className="accountHubSettings" aria-labelledby="account-settings-title">
        <h3 id="account-settings-title">Account settings</h3>
        <div className="accountHubGrid accountHubSettingsGrid">
          <PrivateIdentityEditor />
          <SetAccountPassword />
          <StepOutNudgePref />
          {analyticsControls}
        </div>
      </section>
      <NightMemoryStudio key={user.id} userId={user.id} />
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
