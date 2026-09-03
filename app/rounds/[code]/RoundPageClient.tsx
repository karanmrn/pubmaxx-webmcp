"use client";

import Link from "next/link";
import {
  Check,
  Copy,
  DoorClosed,
  MapPin,
  Plus,
  ReceiptText,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import SiteNav from "@/components/nav/SiteNav";
import {
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  clearActiveRoundCode,
  writeActiveRoundCode,
} from "@/lib/activeRound";
import {
  CATEGORY_META,
  DRINK_CATEGORIES,
  categoryLabel,
  type Drink,
  type DrinkCategory,
} from "@/lib/drinks";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { normalizeHandle } from "@/lib/profiles";
import {
  ROUND_SPEND_PRICE_LINE_MAX,
  isValidRoundCode,
  normalizeRoundCode,
  promotedPriceItems,
  roundTurn,
  type RoundSpendDTO,
  type RoundSpendItemSource,
  type RoundState,
  type RoundViewState,
} from "@/lib/rounds";
import {
  currentStop,
  crewHereSummary,
  roundPresence,
  type PresenceDTO,
} from "@/lib/roundPresence";
import {
  captureRoundRequestIdentity,
  readRoundAnonymousHandle,
  roundJsonRequest,
  roundRequest,
  roundRequestIdentityOwnerKey,
  runRoundMutationForCurrentOwner,
  writeRoundAnonymousHandle,
  type RoundRequestIdentity,
} from "@/lib/roundRequest";
import { buildRouteLegs, formatLeg, formatRouteTotal } from "@/lib/routeLegs";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { loadSlimVenues, type SlimVenue } from "@/lib/venuesSlim";
import { formatPrice, type Venue } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import "./round.css";

// How often the open Round refetches its state. Live-ness by polling — the repo
// convention (the notifications bell polls; no websockets). The page also refetches
// on focus so switching back to the tab shows the latest route immediately.
const POLL_MS = 10_000;

export function roundComposerOwnerKey(
  auth: AccountAuthSnapshot | null,
): string {
  return auth?.userId ?? "anonymous";
}

export function roundViewerHandle(
  viewerMemberHandle: string | undefined,
  viewerOwnerKey: string | null,
  identity: RoundRequestIdentity | null,
  storedHandle: string,
  storedHandleOwnerKey: string | null,
): string {
  if (!identity) return "";
  if (
    viewerOwnerKey === roundRequestIdentityOwnerKey(identity) &&
    viewerMemberHandle
  ) {
    return viewerMemberHandle;
  }
  return identity.kind === "anonymous" &&
    storedHandleOwnerKey === roundRequestIdentityOwnerKey(identity)
    ? storedHandle
    : "";
}

// A minimal Venue shape for buildRouteLegs (read-only): the leg math only reads
// longitude/latitude/id/name off each stop, so we adapt SlimVenue → that shape.
function slimToVenue(slim: SlimVenue): Venue {
  return {
    id: slim.id,
    name: slim.name,
    latitude: slim.lat,
    longitude: slim.lng,
  } as unknown as Venue;
}

export default function RoundPageClient({ params }: { params: Promise<{ code: string }> }): React.JSX.Element {
  const { user, session, loading: authLoading } = useAuth();
  const roundIdentity = useMemo(
    () =>
      authLoading
        ? null
        : captureRoundRequestIdentity(user?.id ?? null, session),
    [authLoading, session, user?.id],
  );
  const roundAuth =
    roundIdentity?.kind === "account" ? roundIdentity.auth : null;
  const roundIdentityOwnerKey = roundRequestIdentityOwnerKey(roundIdentity);
  const roundIdentityRef = useRef<RoundRequestIdentity | null>(roundIdentity);
  useEffect(() => {
    roundIdentityRef.current = roundIdentity;
  }, [roundIdentity]);
  const currentRoundIdentity = useCallback(
    () => roundIdentityRef.current,
    [],
  );
  // Route param resolved after mount (Next 15 async params).
  const [code, setCode] = useState<string>("");
  useEffect(() => {
    let active = true;
    void params.then((p) => {
      if (active) setCode(normalizeRoundCode(p.code));
    });
    return () => {
      active = false;
    };
  }, [params]);

  const [state, setState] = useState<RoundViewState | null>(null);
  const [stateOwnerKey, setStateOwnerKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [anonymousHandle, setAnonymousHandle] = useState<{
    ownerKey: string | null;
    handle: string;
  }>({ ownerKey: null, handle: "" });
  // Presence rows at the Round's CURRENT stop — the "your crew is here" overlay
  // (B6). Fetched from the EXISTING GET /api/presence?venueId=…; the intersection
  // with members happens in the pure lib/roundPresence lens. Fail-soft to [].
  const [presence, setPresence] = useState<PresenceDTO[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      let handle = "";
      if (roundIdentity?.kind === "anonymous") {
        try {
          handle = readRoundAnonymousHandle(window.localStorage);
        } catch {
          handle = "";
        }
      }
      setAnonymousHandle({ ownerKey: roundIdentityOwnerKey, handle });
    });
    return () => {
      active = false;
    };
  }, [roundIdentity?.kind, roundIdentityOwnerKey]);

  // Fetch + poll the Round state while it's open. Fail-soft: a fetch miss leaves
  // the last-known state up rather than blanking the page.
  const refetch = useCallback(async () => {
    if (!code || !roundIdentity) return;
    try {
      const completion = await runRoundMutationForCurrentOwner(
        roundIdentity,
        currentRoundIdentity,
        async () => {
          const res = await roundRequest(
            `/api/rounds/${code}`,
            roundIdentity,
            { cache: "no-store" },
          );
          return {
            res,
            state: res.ok ? ((await res.json()) as RoundViewState) : null,
          };
        },
      );
      if (!completion.current) return;
      const { res, state: next } = completion.value;
      if (res.ok && next) {
        setState(next);
        setStateOwnerKey(roundRequestIdentityOwnerKey(roundIdentity));
      } else if (res.status === 404) {
        setState(null);
        setStateOwnerKey(null);
      }
    } catch {
      // Network blip — keep the last-known state.
    } finally {
      if (
        roundRequestIdentityOwnerKey(roundIdentity) ===
        roundRequestIdentityOwnerKey(currentRoundIdentity())
      ) {
        setLoaded(true);
      }
    }
  }, [code, currentRoundIdentity, roundIdentity]);

  useEffect(() => {
    if (!code) return;
    async function loadRound() {
      await refetch();
    }
    void loadRound();
  }, [code, refetch]);

  const isOpen = state != null && state.round.closedAt == null;

  // Stickiness seam for the map composer (Loop 2): while this Round is open,
  // stamp the active Round key so Pint Drop's "My Round" chip lights up and a
  // successful drop can append the venue as a stop. Clear on leave / close, but
  // only when the stored value still matches THIS code (another tab may have
  // switched Rounds).
  useEffect(() => {
    if (!code || !isValidRoundCode(code)) return;
    if (isOpen) {
      writeActiveRoundCode(code);
      return () => clearActiveRoundCode(code);
    }
    clearActiveRoundCode(code);
    return undefined;
  }, [code, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // Poll only while the tab is actually visible — a backgrounded phone
    // shouldn't burn battery/data hitting the Round every 10s. Coming back to
    // the foreground refetches immediately (focus + visibilitychange) so the
    // route is fresh the moment you look, without waiting out the interval.
    const tick = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [isOpen, refetch]);

  // The current stop's venue id — presence is only ever surfaced for where the
  // crew is now. Recomputed from the polled state; null when there's no stop yet.
  const currentStopVenueId = useMemo(
    () => (state ? (currentStop(state.stops)?.venueId ?? null) : null),
    [state],
  );

  // Poll presence at the current stop alongside the Round poll (same cadence, the
  // repo's live-ness-by-polling convention — the Round page already polls, there's
  // no realtime channel wired here to reuse). Fail-soft: a miss keeps the last
  // rows; a 404/venue change resets. Only while the Round is open with a stop.
  const refetchPresence = useCallback(async () => {
    if (!currentStopVenueId) return;
    try {
      const res = await fetch(`/api/presence?venueId=${encodeURIComponent(currentStopVenueId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { presence?: PresenceDTO[] };
        setPresence(Array.isArray(data.presence) ? data.presence : []);
      }
    } catch {
      // Network blip — keep the last-known presence rather than blanking it.
    }
  }, [currentStopVenueId]);

  useEffect(() => {
    let active = true;
    // Not open, or no stop yet → clear presence and don't arm a poll. Defer the
    // state update out of the synchronous effect body for React 19's lint rule.
    if (!isOpen || !currentStopVenueId) {
      void Promise.resolve().then(() => {
        if (active) setPresence([]);
      });
      return () => {
        active = false;
      };
    }
    void Promise.resolve().then(() => refetchPresence());
    // Same visibility gating as the Round poll: don't poll presence in the
    // background; refetch on wake so "your crew is here" is current on return.
    const tick = () => {
      if (document.visibilityState === "visible") void refetchPresence();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void refetchPresence();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      active = false;
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [isOpen, currentStopVenueId, refetchPresence]);

  const effectiveHandle = roundViewerHandle(
    state?.viewerMemberHandle,
    stateOwnerKey,
    roundIdentity,
    anonymousHandle.handle,
    anonymousHandle.ownerKey,
  );
  const amMember = useMemo(
    () =>
      state && effectiveHandle
        ? state.members.some((m) => m.handle === effectiveHandle)
        : false,
    [effectiveHandle, state],
  );

  // Invalid code / not found → an honest empty state (never a crash).
  if (loaded && (!code || !isValidRoundCode(code) || state == null)) {
    return (
      <main id="main" className="roundShell">
        <SiteNav active="crawls" />
        <EmptyState
          eyebrow="The Round"
          title="No Round here"
          body="This Round doesn't exist, or it's already been called and cleared. Ask your mate for the code, or start a fresh one."
          action={
            <Link href="/crawls" className="roundPrimaryBtn">
              Back to crawls
            </Link>
          }
        />
      </main>
    );
  }

  if (!loaded || state == null) {
    return (
      <main id="main" className="roundShell">
        <SiteNav active="crawls" />
        <p className="roundLoading">Finding the Round…</p>
      </main>
    );
  }

  if (!roundIdentity) {
    return (
      <main id="main" className="roundShell">
        <SiteNav active="crawls" />
        <p className="roundLoading">Refreshing your sign-in…</p>
      </main>
    );
  }

  return (
    <main id="main" className="roundShell">
      <SiteNav active="crawls" />
      <RoundBoard
        key={roundRequestIdentityOwnerKey(roundIdentity) ?? "transitioning"}
        state={state}
        myHandle={effectiveHandle}
        roundAuth={roundAuth}
        roundIdentity={roundIdentity}
        currentRoundIdentity={currentRoundIdentity}
        amMember={amMember}
        presence={presence}
        onChange={(next) => {
          setState(next);
          setStateOwnerKey(roundRequestIdentityOwnerKey(roundIdentity));
        }}
        onAnonymousHandle={(handle) => {
          setAnonymousHandle({ ownerKey: "anonymous", handle });
        }}
      />
    </main>
  );
}

function RoundBoard({
  state,
  myHandle,
  roundAuth,
  roundIdentity,
  currentRoundIdentity,
  amMember,
  presence,
  onChange,
  onAnonymousHandle,
}: {
  state: RoundState;
  myHandle: string;
  roundAuth: AccountAuthSnapshot | null;
  roundIdentity: RoundRequestIdentity;
  currentRoundIdentity: () => RoundRequestIdentity | null;
  amMember: boolean;
  presence: PresenceDTO[];
  onChange: (next: RoundState) => void;
  onAnonymousHandle: (handle: string) => void;
}): React.JSX.Element {
  const { round, members, stops, spends } = state;
  const closed = round.closedAt != null;
  const isCreator = myHandle !== "" && round.createdByHandle === myHandle;
  const rotation = useMemo(() => roundTurn(members, spends), [members, spends]);

  // The "your crew is here" overlay (B6): the pure intersection of members ×
  // presence at the current stop. Recomputed as either the polled Round state or
  // the polled presence rows change. A closed Round shows no live presence (the
  // crawl is over — no honest "here now" claim to make).
  const crewHere = useMemo(
    () => (closed ? null : roundPresence(members, stops, presence)),
    [closed, members, stops, presence],
  );
  const crewLine = crewHere ? crewHereSummary(crewHere) : null;

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copyCode() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(round.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy Round code. Try again.")
      );
    }
  }

  return (
    <div className="roundBoard">
      <header className="roundHead">
        <p className="roundEyebrow">The Round · builds itself live</p>
        <h1 className="roundTitle">{round.title}</h1>
        <RoundMoneyGlance
          currentHandle={rotation.currentHandle}
          latestSpend={spends.at(-1) ?? null}
        />
        <div className="roundCodeRow">
          <span className="roundCodeLabel">Tell your mates</span>
          <button
            type="button"
            className="roundCode"
            onClick={copyCode}
            aria-label={copied ? `Round code ${round.code} copied` : `Copy the Round code ${round.code}`}
          >
            {round.code}
            {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          </button>
          {copied ? (
            <span className="roundCopyFeedback" role="status">
              Code copied.
            </span>
          ) : null}
          {copyError ? (
            <span className="roundCopyFeedback" role="status">
              {copyError}
            </span>
          ) : null}
        </div>
        <p className="roundStatus" role="status">
          {closed ? "This Round has been called. It's closed." : `${members.length} out · still going`}
        </p>
        {crewLine ? (
          <p className="roundCrewHere" role="status">
            <span className="roundHereDot" aria-hidden="true" />
            {crewLine}
          </p>
        ) : null}
      </header>

      {amMember && !closed && stops.length > 0 ? (
        <RoundSpendComposer
          key={roundComposerOwnerKey(roundAuth)}
          code={round.code}
          recorderHandle={myHandle}
          roundAuth={roundAuth}
          roundIdentity={roundIdentity}
          currentRoundIdentity={currentRoundIdentity}
          currentHandle={rotation.currentHandle}
          members={members}
          stops={stops}
          onRecorded={onChange}
        />
      ) : null}

      <RoundSpendHistory spends={spends} />

      <section className="roundMembers" aria-label="Who's in the Round">
        <h2 className="roundSectionTitle">
          <Users size={16} aria-hidden="true" /> Who&apos;s out
        </h2>
        <ul className="roundMemberList">
          {members.map((m) => {
            const here = crewHere ? crewHere.presentHandles.has(normalizeHandle(m.handle)) : false;
            return (
              <li key={m.handle} className={`roundMemberChip${here ? " roundMemberChipHere" : ""}`}>
                {here ? (
                  <span className="roundHereDot" title="Here now, self-shared, ephemeral" aria-label="here now" />
                ) : null}
                <Link href={`/u/${m.handle}`}>@{m.handle}</Link>
                {m.handle === round.createdByHandle ? <span className="roundHostTag">host</span> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <RouteList stops={stops} />

      {!amMember && !closed ? (
        <JoinForm
          code={round.code}
          identity={roundIdentity}
          currentIdentity={currentRoundIdentity}
          initialHandle={myHandle}
          onJoined={(next, handle) => {
            onAnonymousHandle(handle);
            onChange(next);
          }}
        />
      ) : null}

      {amMember && !closed ? (
        <AddStop
          code={round.code}
          identity={roundIdentity}
          currentIdentity={currentRoundIdentity}
          handle={myHandle}
          onAdded={onChange}
          existing={stops.map((s) => s.venueId)}
        />
      ) : null}

      {isCreator && !closed ? (
        <CloseRound
          code={round.code}
          identity={roundIdentity}
          currentIdentity={currentRoundIdentity}
          handle={myHandle}
          onClosed={onChange}
        />
      ) : null}
    </div>
  );
}

function roundDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not known";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function RoundMoneyGlance({
  currentHandle,
  latestSpend,
}: {
  currentHandle: string | null;
  latestSpend: RoundSpendDTO | null;
}): React.JSX.Element {
  return (
    <section
      className="roundMoneyGlance"
      aria-label="Whose round and what it cost"
    >
      <div className="roundMoneyCell roundMoneyTurn">
        <span className="roundMoneyLabel">Up now</span>
        <strong>{currentHandle ? `@${currentHandle}` : "Nobody yet"}</strong>
        <small>{latestSpend ? "Next in the rotation" : "First round"}</small>
      </div>
      <div className="roundMoneyCell roundMoneyLatest">
        <span className="roundMoneyLabel">Last round</span>
        {latestSpend ? (
          <>
            <strong>{formatPrice(latestSpend.totalPence / 100)}</strong>
            <small>
              paid by @{latestSpend.payerHandle} · {latestSpend.venueName}
            </small>
          </>
        ) : (
          <>
            <strong className="roundMoneyEmpty">No round logged yet</strong>
            <small>Keep the first one when it lands</small>
          </>
        )}
      </div>
    </section>
  );
}

type DraftRoundItem = {
  id: string;
  drinkName: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  priceSource: RoundSpendItemSource;
};

// What the "known prices here" picker last put in the drink row. The line keeps
// the menu's provenance only while the figure is still the menu's: edit the
// price and it becomes the drinker's own claim.
type KnownDrinkPrefill = {
  drinkName: string;
  drinkCategory: DrinkCategory;
  priceGbp: string;
  priceSource: RoundSpendItemSource;
};

// One reading of a typed money field, so the price a line is judged on and the
// price it is added at can never come apart.
function readMoneyInput(raw: string): string {
  return raw.replace(/[£\s]/g, "").replace(",", ".");
}

function draftItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function spendClientRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `round-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function RoundSpendComposer({
  code,
  recorderHandle,
  roundAuth,
  roundIdentity,
  currentRoundIdentity,
  currentHandle,
  members,
  stops,
  onRecorded,
}: {
  code: string;
  recorderHandle: string;
  roundAuth: AccountAuthSnapshot | null;
  roundIdentity: RoundRequestIdentity;
  currentRoundIdentity: () => RoundRequestIdentity | null;
  currentHandle: string | null;
  members: RoundState["members"];
  stops: RoundState["stops"];
  onRecorded: (next: RoundState) => void;
}): React.JSX.Element {
  const latestStop = stops.at(-1)!;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"total" | "items">("total");
  const [payerHandle, setPayerHandle] = useState(currentHandle ?? recorderHandle);
  const [venueId, setVenueId] = useState(latestStop.venueId);
  const [total, setTotal] = useState("");
  const [items, setItems] = useState<DraftRoundItem[]>([]);
  const [knownDrinks, setKnownDrinks] = useState<Drink[]>([]);
  const [knownDrinkId, setKnownDrinkId] = useState("");
  const [menuLoading, setMenuLoading] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState<DrinkCategory>("beer");
  const [manualPrice, setManualPrice] = useState("");
  const [prefill, setPrefill] = useState<KnownDrinkPrefill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!open || mode !== "items") return;
    let active = true;
    async function loadKnownDrinks() {
      setMenuLoading(true);
      try {
        const res = await fetch(`/api/venue/${encodeURIComponent(venueId)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          discardBody(res);
          if (active) setKnownDrinks([]);
          return;
        }
        const data = (await res.json()) as { venue?: Venue };
        const menu = data.venue
          ? venueMenuForInspector(data.venue)
              .filter(
                (drink) =>
                  Number.isFinite(drink.priceGbp) &&
                  drink.priceGbp >= 1 &&
                  drink.priceGbp <= 30,
              )
              .slice(0, 40)
          : [];
        if (active) {
          setKnownDrinks(menu);
          setKnownDrinkId(menu[0]?.id ?? "");
        }
      } catch {
        if (active) setKnownDrinks([]);
      } finally {
        if (active) setMenuLoading(false);
      }
    }
    void loadKnownDrinks();
    return () => {
      active = false;
    };
  }, [mode, open, venueId]);

  const itemTotal = items.reduce((sum, item) => sum + item.priceGbp, 0);
  const parsedTotal = Number(readMoneyInput(total));
  const amount =
    mode === "items"
      ? itemTotal
      : Number.isFinite(parsedTotal) && parsedTotal > 0
        ? parsedTotal
        : null;
  const keepLabel = amount ? `Keep ${formatPrice(amount)}` : "Keep this round";

  function openForm() {
    setPayerHandle(currentHandle ?? recorderHandle);
    setVenueId(stops.at(-1)?.venueId ?? latestStop.venueId);
    setError(null);
    setOpen(true);
  }

  function fillFromKnownDrink() {
    const drink = knownDrinks.find((candidate) => candidate.id === knownDrinkId);
    if (!drink) return;
    const priceGbp = drink.priceGbp.toFixed(2);
    setManualName(drink.name);
    setManualCategory(drink.category);
    setManualPrice(priceGbp);
    setPrefill({
      drinkName: drink.name,
      drinkCategory: drink.category,
      priceGbp,
      priceSource: drink.provenance.source === "seed" ? "demo" : "round",
    });
    setError(null);
  }

  // A line is the drinker's own claim unless every field is still exactly what
  // the demo menu put there.
  function draftPriceSource(
    drinkName: string,
    drinkCategory: DrinkCategory,
    priceGbp: string,
  ): RoundSpendItemSource {
    if (!prefill || prefill.priceSource !== "demo") return "round";
    const untouched =
      prefill.drinkName === drinkName &&
      prefill.drinkCategory === drinkCategory &&
      Number(prefill.priceGbp) === Number(priceGbp);
    return untouched ? "demo" : "round";
  }

  const firstPartyDrafts = items.filter((item) => item.priceSource === "round");

  // What the drink row would be logged as as it stands right now, so the note
  // beside it never describes a figure the drinker has already changed.
  const draftSource = draftPriceSource(
    manualName.trim(),
    manualCategory,
    readMoneyInput(manualPrice),
  );

  function addManualDrink() {
    const cleanedPrice = readMoneyInput(manualPrice);
    const price = Number(cleanedPrice);
    const drinkName = manualName.trim();
    if (!drinkName || !Number.isFinite(price) || price < 1 || price > 30) {
      setError("Add a drink name and a price from £1 to £30.");
      return;
    }
    const priceSource = draftPriceSource(drinkName, manualCategory, cleanedPrice);
    if (
      priceSource === "round" &&
      firstPartyDrafts.length >= ROUND_SPEND_PRICE_LINE_MAX
    ) {
      setError(
        `You can log ${ROUND_SPEND_PRICE_LINE_MAX} drink prices in one round. Keep this one, then start another.`,
      );
      return;
    }
    setItems((held) => [
      ...held,
      {
        id: draftItemId(),
        drinkName,
        drinkCategory: manualCategory,
        priceGbp: Math.round(price * 100) / 100,
        priceSource,
      },
    ]);
    setManualName("");
    setManualPrice("");
    setPrefill(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "total" && (!amount || amount < 1 || amount > 1000)) {
      setError("Type what the round came to, from £1 to £1,000.");
      return;
    }
    if (mode === "items" && items.length === 0) {
      setError("Add at least one drink, or use the quick total.");
      return;
    }
    if (user && !roundAuth) {
      setError("Your sign-in changed. Try again.");
      return;
    }
    setBusy(true);
    setError(null);
    pendingRef.current ??= spendClientRef();
    try {
      const completion = await runRoundMutationForCurrentOwner(
        roundIdentity,
        currentRoundIdentity,
        async () => {
          const res = await roundJsonRequest(
            `/api/rounds/${code}`,
            roundIdentity,
            {
              action: "recordSpend",
              handle: recorderHandle,
              payerHandle,
              venueId,
              clientRef: pendingRef.current,
              ...(mode === "items"
                ? {
                    items: items.map(
                      ({
                        drinkName,
                        drinkCategory,
                        priceGbp,
                        priceSource,
                      }) => ({
                        drinkName,
                        drinkCategory,
                        priceGbp,
                        priceSource,
                      }),
                    ),
                  }
                : { totalGbp: amount }),
            },
          );
          return {
            res,
            data: (await res.json()) as RoundState | { error: unknown },
          };
        },
      );
      if (!completion.current) return;
      const { res, data } = completion.value;
      if (!res.ok) {
        setError(errorMessageFrom(data, "Could not keep that round."));
        return;
      }
      pendingRef.current = null;
      setTotal("");
      setItems([]);
      setOpen(false);
      onRecorded(data as RoundState);
    } catch {
      setError("Could not keep that round. Try again.");
    } finally {
      if (
        roundRequestIdentityOwnerKey(roundIdentity) ===
        roundRequestIdentityOwnerKey(currentRoundIdentity())
      ) {
        setBusy(false);
      }
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="roundPrimaryBtn roundRecordOpen"
        onClick={openForm}
      >
        <ReceiptText size={17} aria-hidden="true" /> Put this round on the mat
      </button>
    );
  }

  return (
    <section className="roundSpendPanel" aria-label="Record this round">
      <form className="roundSpendForm" onSubmit={submit}>
        <div className="roundSpendHead">
          <div>
            <p className="roundSectionTitle">Keep this round</p>
            <p className="roundSpendIntro">
              Record what was spent. No balances, bills or settling up.
            </p>
          </div>
          <button
            type="button"
            className="roundIconBtn"
            onClick={() => setOpen(false)}
            aria-label="Close round cost form"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="roundSpendGrid">
          <label className="roundField">
            <span>Who got this one</span>
            <select
              value={payerHandle}
              onChange={(event) => setPayerHandle(event.target.value)}
            >
              {members.map((member) => (
                <option key={member.handle} value={member.handle}>
                  @{member.handle}
                </option>
              ))}
            </select>
          </label>
          <label className="roundField">
            <span>Pub</span>
            <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              {stops.map((stop) => (
                <option key={stop.id} value={stop.venueId}>
                  {stop.venueName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="roundSpendModes" aria-label="How to record the round">
          <button
            type="button"
            className={mode === "total" ? "isActive" : ""}
            onClick={() => setMode("total")}
            aria-pressed={mode === "total"}
          >
            Quick total
          </button>
          <button
            type="button"
            className={mode === "items" ? "isActive" : ""}
            onClick={() => setMode("items")}
            aria-pressed={mode === "items"}
          >
            Itemise drinks
          </button>
        </div>

        {mode === "total" ? (
          <label className="roundField roundTotalField">
            <span>Round total</span>
            <span className="roundMoneyInput">
              <span aria-hidden="true">£</span>
              <input
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                placeholder="26.80"
                aria-label="Round total"
                autoComplete="off"
              />
            </span>
          </label>
        ) : (
          <div className="roundItems">
            <div className="roundKnownDrink">
              <label className="roundField">
                <span>Known prices here</span>
                <select
                  value={knownDrinkId}
                  onChange={(event) => setKnownDrinkId(event.target.value)}
                  disabled={menuLoading || knownDrinks.length === 0}
                >
                  {knownDrinks.length > 0 ? (
                    knownDrinks.map((drink) => (
                      <option key={drink.id} value={drink.id}>
                        {drink.name} · {formatPrice(drink.priceGbp)}
                        {drink.provenance.source === "seed" ? " · demo menu" : ""}
                      </option>
                    ))
                  ) : (
                    <option value="">
                      {menuLoading ? "Finding known prices…" : "No known prices here"}
                    </option>
                  )}
                </select>
              </label>
              <button
                type="button"
                className="roundSecondaryBtn"
                onClick={fillFromKnownDrink}
                disabled={!knownDrinkId}
              >
                <Plus size={16} aria-hidden="true" /> Fill in
              </button>
            </div>

            <p className="roundKnownDrinkNote">
              A known price only fills the line below. Check it against what you
              paid, then add it.
              {draftSource === "demo"
                ? " This line still reads our demo menu, so it goes in the diary and is not logged as a price. Change the figure to what you paid and it counts as yours."
                : ""}
            </p>

            <div className="roundManualDrink">
              <label className="roundField roundDrinkName">
                <span>The drink</span>
                <input
                  type="text"
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="Drink name"
                  maxLength={80}
                />
              </label>
              <label className="roundField">
                <span>Type</span>
                <select
                  value={manualCategory}
                  onChange={(event) =>
                    setManualCategory(event.target.value as DrinkCategory)
                  }
                >
                  {DRINK_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_META[category].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="roundField roundDrinkPrice">
                <span>Price</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.target.value)}
                  placeholder="6.20"
                  aria-label="Drink price"
                />
              </label>
              <button
                type="button"
                className="roundSecondaryBtn roundAddDrinkBtn"
                onClick={addManualDrink}
              >
                <Plus size={16} aria-hidden="true" /> Add drink
              </button>
            </div>

            {items.length > 0 ? (
              <ul className="roundDraftItems">
                {items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.drinkName}</strong>
                      <small>
                        {categoryLabel(item.drinkCategory)}
                        {item.priceSource === "demo" ? " · diary only" : ""}
                      </small>
                    </span>
                    <span className="roundDraftItemPrice">
                      {formatPrice(item.priceGbp)}
                      <button
                        type="button"
                        className="roundIconBtn"
                        onClick={() =>
                          setItems((held) =>
                            held.filter((candidate) => candidate.id !== item.id),
                          )
                        }
                        aria-label={`Remove ${item.drinkName}`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="roundPriceTrust">
              Drink lines you type are first-party price logs. One person&apos;s
              log stays off the price map until another drinker backs it. A line
              marked diary only is never logged as a price.
            </p>
          </div>
        )}

        {error ? (
          <p className="roundError" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="roundPrimaryBtn roundKeepBtn"
          disabled={busy}
        >
          {busy ? "Keeping…" : keepLabel}
        </button>
      </form>
    </section>
  );
}

function provisionalPriceCaption(logged: number, lines: number): string {
  if (logged === lines) {
    return logged === 1
      ? "This drink price stays provisional until another drinker backs it."
      : "These drink prices stay provisional until another drinker backs them.";
  }
  return logged === 1
    ? "One of these prices stays provisional until another drinker backs it."
    : `${logged} of these prices stay provisional until another drinker backs them.`;
}

function diaryOnlyCaption(diaryOnly: number): string {
  return diaryOnly === 1
    ? "One line stays in this diary and was not shared as a community price."
    : `${diaryOnly} lines stay in this diary and were not shared as community prices.`;
}

function supersededCaption(superseded: number): string {
  return superseded === 1
    ? "One earlier line was superseded by a later price from this account."
    : `${superseded} earlier lines were superseded by later prices from this account.`;
}

export function RoundSpendHistory({
  spends,
}: {
  spends: readonly RoundSpendDTO[];
}): React.JSX.Element | null {
  if (spends.length === 0) return null;
  return (
    <section className="roundSpendHistory" aria-label="Rounds kept tonight">
      <h2 className="roundSectionTitle">
        <ReceiptText size={16} aria-hidden="true" /> Rounds kept tonight
      </h2>
      <ol>
        {[...spends].reverse().map((spend) => {
          const logged = promotedPriceItems(spend.items);
          const legacyUnknown = spend.items.filter(
            (item) => item.promotionStatus === "legacy_unknown",
          ).length;
          const superseded = spend.items.filter(
            (item) => item.promotionStatus === "superseded",
          ).length;
          const diaryOnly =
            spend.items.length - logged.length - legacyUnknown - superseded;
          return (
            <li key={spend.id} className="roundSpendCard">
              <div className="roundSpendSummary">
                <div>
                  <strong>{spend.venueName}</strong>
                  <span>paid by @{spend.payerHandle}</span>
                </div>
                <strong className="roundSpendTotal">
                  {formatPrice(spend.totalPence / 100)}
                </strong>
              </div>
              <p className="roundSpendStamp">
                {roundDateLabel(spend.recordedAt)} · Logged in this Round by @
                {spend.recordedByHandle}
              </p>
              {spend.items.length > 0 ? (
                <>
                  <ul className="roundSpendItems">
                    {spend.items.map((item, index) => (
                      <li key={`${spend.id}-${index}`}>
                        <span>
                          {item.drinkName} · {categoryLabel(item.drinkCategory)}
                          {item.promotionStatus === "legacy_unknown"
                            ? " · sharing status unknown"
                            : item.promotionStatus === "superseded"
                              ? " · superseded by a later price"
                            : item.promotionStatus !== "promoted"
                              ? " · diary only"
                              : ""}
                        </span>
                        <strong>{formatPrice(item.pricePence / 100)}</strong>
                      </li>
                    ))}
                  </ul>
                  {logged.length > 0 ? (
                    <p className="roundPriceTrust">
                      {provisionalPriceCaption(logged.length, spend.items.length)}
                    </p>
                  ) : null}
                  {diaryOnly > 0 ? (
                    <p className="roundPriceTrust">{diaryOnlyCaption(diaryOnly)}</p>
                  ) : null}
                  {legacyUnknown > 0 ? (
                    <p className="roundPriceTrust">
                      {legacyUnknown === 1
                        ? "Sharing status for one older line is unknown."
                        : `Sharing status for ${legacyUnknown} older lines is unknown.`}
                    </p>
                  ) : null}
                  {superseded > 0 ? (
                    <p className="roundPriceTrust">
                      {supersededCaption(superseded)}
                    </p>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// The self-building route as a numbered stop list with who-added-what + a running
// leg summary. Coords for the leg math are resolved from the slim index once.
function RouteList({ stops }: { stops: RoundState["stops"] }): React.JSX.Element {
  const [venueIndex, setVenueIndex] = useState<Map<string, SlimVenue>>(new Map());
  useEffect(() => {
    let active = true;
    void loadSlimVenues().then((venues) => {
      if (!active) return;
      setVenueIndex(new Map(venues.map((v) => [v.id, v])));
    });
    return () => {
      active = false;
    };
  }, []);

  // Build the leg summary from resolved coords — a stop whose id isn't in the slim
  // index simply drops out of the leg math (its name still shows in the list).
  const summary = useMemo(() => {
    const resolved: Venue[] = stops
      .map((s) => venueIndex.get(s.venueId))
      .filter((v): v is SlimVenue => v != null)
      .map(slimToVenue);
    return buildRouteLegs(resolved);
  }, [stops, venueIndex]);

  if (stops.length === 0) {
    return (
      <EmptyState
        eyebrow="The route"
        title="No stops yet"
        body="The route builds itself as people drop pints. There's always one person who has to name the first pub. Tonight that's you."
      />
    );
  }

  return (
    <section className="roundRoute" aria-label="The Round's route">
      <h2 className="roundSectionTitle">
        <MapPin size={16} aria-hidden="true" /> The route so far
      </h2>
      <ol className="roundStops">
        {stops.map((stop, index) => (
          <li key={stop.id} className="roundStop">
            <span className="roundStopNumber" aria-hidden="true">
              {index + 1}
            </span>
            <div className="roundStopBody">
              <strong>{stop.venueName}</strong>
              <span className="roundStopBy">
                added by <Link href={`/u/${stop.addedByHandle}`}>@{stop.addedByHandle}</Link>
              </span>
            </div>
          </li>
        ))}
      </ol>
      {summary.legs.length > 0 ? (
        <div className="roundLegs">
          <ul>
            {summary.legs.map((leg) => (
              <li key={leg.fromIndex}>
                {leg.from.name} → {leg.to.name}: {formatLeg(leg)}
              </li>
            ))}
          </ul>
          <p className="roundLegTotal">{formatRouteTotal(summary)}</p>
        </div>
      ) : null}
    </section>
  );
}

function JoinForm({
  code,
  identity,
  currentIdentity,
  initialHandle,
  onJoined,
}: {
  code: string;
  identity: RoundRequestIdentity;
  currentIdentity: () => RoundRequestIdentity | null;
  initialHandle: string;
  onJoined: (next: RoundState, anonymousHandle: string) => void;
}): React.JSX.Element {
  const [handle, setHandle] = useState(initialHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeHandle(handle);
    if (!clean) {
      setError("Pick a handle to join.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const completion = await runRoundMutationForCurrentOwner(
        identity,
        currentIdentity,
        async () => {
          const res = await roundJsonRequest(`/api/rounds/${code}`, identity, {
            action: "join",
            handle: clean,
          });
          return {
            res,
            data: (await res.json()) as RoundState | { error: unknown },
          };
        },
      );
      if (!completion.current) return;
      const { res, data } = completion.value;
      if (res.ok) {
        let anonymousHandle = "";
        if (identity.kind === "anonymous") {
          try {
            anonymousHandle = writeRoundAnonymousHandle(
              identity,
              clean,
              window.localStorage,
            );
          } catch {
            anonymousHandle = "";
          }
        }
        onJoined(data as RoundState, anonymousHandle);
      } else {
        setError(errorMessageFrom(data, "Could not join."));
      }
    } catch {
      setError("Could not join. Try again.");
    } finally {
      if (
        roundRequestIdentityOwnerKey(identity) ===
        roundRequestIdentityOwnerKey(currentIdentity())
      ) {
        setBusy(false);
      }
    }
  }

  return (
    <form className="roundForm" onSubmit={submit}>
      <h2 className="roundSectionTitle">Join this Round</h2>
      <label className="roundField">
        <span>Your handle</span>
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. cheap_pint_ken"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={30}
        />
      </label>
      {error ? (
        <p className="roundError" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="roundPrimaryBtn" disabled={busy}>
        {busy ? "Joining…" : "I'm out too. Join the Round"}
      </button>
    </form>
  );
}

// Add a pub to the Round. Two honest seams:
//  1. Search the slim index and add a pub directly (a member marks where they are).
//  2. "Log a pint here" links to the map composer for a full Pint Drop — the
//     composer flow is owned by another agent, so this is the smallest honest seam
//     into it. Full auto-append from the composer (a drop with an active round code
//     appends the stop for you) can land later; the addStop action already accepts
//     a drop_ref for when it does. See the store header + issue #26.
function AddStop({
  code,
  identity,
  currentIdentity,
  handle,
  existing,
  onAdded,
}: {
  code: string;
  identity: RoundRequestIdentity;
  currentIdentity: () => RoundRequestIdentity | null;
  handle: string;
  existing: string[];
  onAdded: (next: RoundState) => void;
}): React.JSX.Element {
  const [venues, setVenues] = useState<SlimVenue[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  const loadedRef = useRef(false);

  // Load the slim index lazily on first focus of the search — same source the map
  // uses, so a stop deep-links + prices by the same id everywhere. `ready` gates
  // the empty-vs-loading copy so a search never dead-ends on a silent blank.
  const ensureLoaded = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const loaded = await loadSlimVenues();
    setVenues(loaded);
    setReady(true);
  }, []);

  // A query is "active" once it's long enough to search — below that we show
  // nothing (not an empty state), matching the map's search idiom.
  const hasQuery = query.trim().length >= 2;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return venues
      .filter(
        (v) =>
          isPubVenueKind(v.kind) &&
          v.name.toLowerCase().includes(q) &&
          !existingSet.has(v.id),
      )
      .slice(0, 8);
  }, [query, venues, existingSet]);

  async function add(venue: SlimVenue) {
    setBusy(true);
    setError(null);
    try {
      const completion = await runRoundMutationForCurrentOwner(
        identity,
        currentIdentity,
        async () => {
          const res = await roundJsonRequest(
            `/api/rounds/${code}`,
            identity,
            {
              action: "addStop",
              handle,
              venueId: venue.id,
              venueName: venue.name,
            },
          );
          return {
            res,
            data: (await res.json()) as RoundState | { error: unknown },
          };
        },
      );
      if (!completion.current) return;
      const { res, data } = completion.value;
      if (res.ok) {
        setQuery("");
        onAdded(data as RoundState);
      } else {
        setError(errorMessageFrom(data, "Could not add that pub."));
      }
    } catch {
      setError("Could not add that pub. Try again.");
    } finally {
      if (
        roundRequestIdentityOwnerKey(identity) ===
        roundRequestIdentityOwnerKey(currentIdentity())
      ) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="roundAdd" aria-label="Add a pub to the Round">
      <h2 className="roundSectionTitle">Add this pub</h2>
      <p className="roundAddHint">Where are you now? Add it and the route grows.</p>
      <input
        type="text"
        className="roundSearch"
        value={query}
        onFocus={ensureLoaded}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a pub by name…"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="search"
        disabled={busy}
      />
      {matches.length > 0 ? (
        <ul className="roundSearchResults">
          {matches.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => add(v)} disabled={busy}>
                <strong>{v.name}</strong>
                <span>{v.borough}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : hasQuery ? (
        // Never a silent blank: while the index loads it's "Finding pubs…"; once
        // loaded with no hit it's an honest miss that points to the map fallback.
        <p className="roundSearchHint" role="status">
          {ready
            ? "No pub by that name on the map. Check the spelling, or log it on the map below."
            : "Finding pubs…"}
        </p>
      ) : null}
      {error ? (
        <p className="roundError" role="alert">
          {error}
        </p>
      ) : null}
      <Link href="/map?log=1" className="roundSecondaryBtn">
        <MapPin size={16} aria-hidden="true" /> Log a pint on the map
      </Link>
    </section>
  );
}

function CloseRound({
  code,
  identity,
  currentIdentity,
  handle,
  onClosed,
}: {
  code: string;
  identity: RoundRequestIdentity;
  currentIdentity: () => RoundRequestIdentity | null;
  handle: string;
  onClosed: (next: RoundState) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Closing a Round is irreversible and hits the whole crew, so it's a two-tap
  // action: the first tap arms a confirm, the second commits. The armed state
  // auto-disarms so a stray tap can't leave the "call it" button hot all night.
  const [confirming, setConfirming] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    },
    [],
  );

  function arm() {
    setConfirming(true);
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setConfirming(false), 5000);
  }

  async function close() {
    setBusy(true);
    setError("");
    try {
      const completion = await runRoundMutationForCurrentOwner(
        identity,
        currentIdentity,
        async () => {
          const res = await roundJsonRequest(`/api/rounds/${code}`, identity, {
            action: "close",
            handle,
          });
          const data = await res.json().catch(() => null);
          return {
            res,
            data: res.ok
              ? (data as RoundState | null)
              : (data as { error?: unknown } | null),
          };
        },
      );
      if (!completion.current) return;
      const { res, data } = completion.value;
      if (res.ok && data) {
        onClosed(data as RoundState);
      } else {
        setError(
          offlineOrMessage(errorMessageFrom(data, "Could not close the Round. Try again."))
        );
      }
    } catch {
      setError(
        offlineOrMessage("Could not close the Round. Try again.")
      );
    } finally {
      if (
        roundRequestIdentityOwnerKey(identity) ===
        roundRequestIdentityOwnerKey(currentIdentity())
      ) {
        setBusy(false);
      }
    }
  }

  if (confirming) {
    return (
      <div className="roundCloseConfirm" role="group" aria-label="Confirm calling the Round">
        <p className="roundCloseConfirmText">Call it for the whole crew? This closes the Round for good.</p>
        <div className="roundCloseConfirmRow">
          <button
            type="button"
            className="roundSecondaryBtn"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Keep going
          </button>
          <button type="button" className="roundCloseBtn roundCloseBtnArmed" onClick={close} disabled={busy}>
            <DoorClosed size={16} aria-hidden="true" /> {busy ? "Calling it…" : "Yes, call it"}
          </button>
        </div>
        {error ? <p className="roundError" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <button type="button" className="roundCloseBtn" onClick={arm} disabled={busy}>
        <DoorClosed size={16} aria-hidden="true" /> Call the Round (close it)
      </button>
      {error ? <p className="roundError" role="alert">{error}</p> : null}
    </>
  );
}
