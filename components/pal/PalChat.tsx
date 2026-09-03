"use client";

// Pub Pal chat surface (/pal/chat) — a chat SKIN over Night OS Ask (`/api/ask`,
// ADR 0014). The user asks in natural language; the tool registry answers from
// listed pubs, What's On, CityMCP, heritage, and prices. Cards keep provenance.
// Proposals need an explicit Confirm (ADR 0006). In-thread turns may refine an
// ask; durable Pal memory stays confirm-gated elsewhere. Web grounding stays
// OFF (lib/palChat PAL_WEB_GROUNDING).

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";

import { useAuth } from "@/components/auth/AuthProvider";
import IntentLink from "@/components/nav/IntentLink";
import SiteNav from "@/components/nav/SiteNav";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import type { AskProposal } from "@/lib/ask/types";
import { occupancyReceiptLine } from "@/lib/occupancy";
import { confirmOccupancyProposal } from "@/components/map/useVenueOccupancy";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { writeAskPlanDraft } from "@/lib/conciergeAskClient";
import { rankNearMe } from "@/lib/nearMeAnswer";
import { CENTRAL_PATCH, readRememberedArea, resolveNightPatch } from "@/lib/nightPatches";
import {
  palKnownVenueIds,
  resolvePalVenueOpenTarget,
} from "@/lib/palOpenVenue";
import { formatPalWhen, type PalAnswer, type PalCard } from "@/lib/palChat";
import { venueAcceptUrl } from "@/lib/venueMapUrl";
import { palRecall, type PalRecall } from "@/lib/palRecall";
import { palLocalityLine, resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
import { writePlanningIntent } from "@/lib/planningIntent";
import { createPalChatSession } from "@/lib/palChatClient";
import {
  cheapestGlanceLine,
  countTonightKinds,
  GLANCE_QUIET_EXIT,
  GLANCE_QUIET_LINE,
  tonightGlanceLine,
  type CheapestGlanceCard,
} from "@/lib/palGlance";
import { formatPrice } from "@/lib/venues";
import {
  loadSlimVenuesForCity,
  loadSlimVenuesForCityResult,
} from "@/lib/venuesSlim";
import { VibeChipButton, VibeChips } from "@/components/vibe/VibeChips";
import { VIBE_CHIPS } from "@/lib/vibeChips";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";

import "./palChat.css";

type Entry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "answer";
      id: string;
      answer: PalAnswer;
      locality: PalLocality | null;
      proposals: AskProposal[];
      /** In-thread recall only (lib/palRecall). Never a durable memory. */
      recall: PalRecall | null;
    }
  | { kind: "error"; id: string; message: string };

function VenueLink({
  card,
  onOpen,
  knownVenueIds,
  children,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds: ReadonlySet<string> | null;
  children: React.ReactNode;
}) {
  // A card is only tappable when it deep-links to a real venue on the map. The
  // static variant still renders every fact and its provenance.
  if (!card.venueId) {
    return <div className="palChatCardMain">{children}</div>;
  }
  const target = resolvePalVenueOpenTarget(card.venueId, knownVenueIds);
  const href = target.href;
  return (
    <Link
      className="palChatCardMain palChatCardBody--link"
      href={href}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(card.venueId);
      }}
    >
      {children}
    </Link>
  );
}

function ProvChip({ card }: { card: PalCard }) {
  // Provenance is non-negotiable and kept on every card. A What's-On row carries
  // an attributable link; a first-party directory row reads "On record".
  const { provenance } = card;
  const label = provenance.label;
  if (provenance.url) {
    return (
      <a
        className="palChatProv palChatProv--link"
        href={provenance.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </a>
    );
  }
  return <span className="palChatProv">{label}</span>;
}

// Explicit Pub Pal acceptance (§4.8: Pal owns its own "Use this Venue", distinct
// from browsing). Writes a source-"pal" PlanningIntent then hands off to the Map
// acceptance URL. Storage failure is swallowed by writePlanningIntent; the href
// still carries accept=1&src=pal so the handoff never depends on client storage.
function acceptPalVenue(card: PalCard, locality: PalLocality | null): void {
  writePlanningIntent({
    source: "pal",
    cityId: DEFAULT_CITY_ID,
    acceptedVenueId: card.venueId,
    acceptedArea: locality?.area ?? null,
    startsAt: null,
    displayEvidence: {
      kind: card.provenance.kind === "whats-on" ? "whats-on" : "directory",
      observedAt: card.when ?? null,
    },
  });
  trackEvent("venue_accepted", { source: "pal" });
}

export function AnswerCard({
  card,
  onOpen,
  knownVenueIds = null,
  palHandoff,
  locality,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds?: ReadonlySet<string> | null;
  palHandoff: boolean;
  locality: PalLocality | null;
}) {
  const when = card.when ? formatPalWhen(card.when) : "";
  return (
    <li className="palChatCard">
      <div className="palChatCardBody">
        <VenueLink card={card} onOpen={onOpen} knownVenueIds={knownVenueIds}>
          <div className="palChatCardTop">
            <p className="palChatCardTitle">{card.title}</p>
            {typeof card.price === "number" ? (
              <span className="palChatCardPrice">£{card.price.toFixed(2)}</span>
            ) : null}
          </div>
          {card.place ? (
            <p className="palChatCardPlace">
              <MapPin size={12} aria-hidden="true" />
              <span>{card.place}</span>
            </p>
          ) : null}
          {when ? <p className="palChatCardWhen">{when}</p> : null}
          {card.note ? <p className="palChatCardNote">{card.note}</p> : null}
          {card.venueId ? (
            <span className="palChatCardCta" aria-hidden="true">
              Show on map
            </span>
          ) : null}
        </VenueLink>
        <div className="palChatCardMeta">
          <ProvChip card={card} />
          {card.confidence ? (
            <span className="palChatConfidence">{card.confidence}</span>
          ) : null}
        </div>
      </div>
      {palHandoff && card.venueId ? (
        <Link
          className="palChatCardAccept pressable"
          href={venueAcceptUrl(card.venueId, "pal")}
          onClick={() => acceptPalVenue(card, locality)}
        >
          Use this Venue
        </Link>
      ) : null}
    </li>
  );
}

export default function PalChat({ palHandoff = false }: { palHandoff?: boolean }) {
  const router = useRouter();
  const { user, session } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [knownVenueIds, setKnownVenueIds] = useState<ReadonlySet<string> | null>(null);
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPalChatSession> | null>(null);
  const counterRef = useRef(0);
  // Every ask this thread has carried, oldest first. In-thread only.
  const priorAsksRef = useRef<string[]>([]);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `t-${counterRef.current}`;
  }, []);

  useEffect(() => {
    let alive = true;
    void loadSlimVenuesForCityResult(DEFAULT_CITY_ID)
      .then((result) => {
        if (!alive) return;
        setKnownVenueIds(
          result.status === "ready" ? palKnownVenueIds(result.rows) : null,
        );
      })
      .catch(() => {
        if (!alive) return;
        setKnownVenueIds(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const openVenue = useCallback(
    (venueId: string) => {
      trackEvent("concierge_result_tap");
      const target = resolvePalVenueOpenTarget(venueId, knownVenueIds);
      router.push(target.href);
    },
    [knownVenueIds, router],
  );

  // Keep the newest turn in view as the transcript grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, pending]);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || pending) return;
      sessionRef.current ??= createPalChatSession();
      // Read the recall BEFORE this ask joins the transcript, so the Pal never
      // recalls the question it is answering.
      const recall = palRecall(priorAsksRef.current, text);
      priorAsksRef.current = [...priorAsksRef.current, text].slice(-12);
      setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setQuery("");
      setPending(true);
      trackEvent("concierge_ask");
      const result = await sessionRef.current(text, DEFAULT_CITY_ID);
      setPending(false);
      if (result === null) return; // superseded by a newer ask — do nothing
      if (result.status === "error") {
        setEntries((prev) => [
          ...prev,
          { kind: "error", id: nextId(), message: result.message },
        ]);
        return;
      }
      // Ground WHERE this answer applies from the query and remembered area,
      // only when the handoff is on. Off = no locality copy, byte-identical.
      const locality = palHandoff ? resolvePalLocality(text, readRememberedArea()) : null;
      const proposals =
        result.status === "answered" || result.status === "empty"
          ? result.proposals ?? []
          : [];
      setEntries((prev) => [
        ...prev,
        { kind: "answer", id: nextId(), answer: result, locality, proposals, recall },
      ]);
    },
    [nextId, pending, palHandoff],
  );

  const dismissProposal = useCallback((entryId: string, proposalId: string) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.kind !== "answer" || entry.id !== entryId) return entry;
        return {
          ...entry,
          proposals: entry.proposals.filter((p) => p.id !== proposalId),
        };
      }),
    );
  }, []);

  const confirmProposal = useCallback((proposal: AskProposal, entryId?: string) => {
    if (proposal.kind === "open_venue") {
      openVenue(proposal.venueId);
      return;
    }
    trackEvent("concierge_result_tap");
    if (proposal.kind === "fly_to") {
      const params = new URLSearchParams({
        lat: String(proposal.lat),
        lng: String(proposal.lng),
      });
      if (proposal.place) params.set("place", proposal.place);
      window.location.assign(`/map?${params.toString()}`);
      return;
    }
    if (proposal.kind === "draft_plan") {
      writeAskPlanDraft({
        query: proposal.query,
        stopIds: proposal.stopIds,
        stopNames: proposal.stopNames,
        createdAt: new Date().toISOString(),
      });
      window.location.assign("/plan");
      return;
    }
    if (proposal.kind === "report_occupancy") {
      void (async () => {
        const result = await confirmOccupancyProposal(
          { venueId: proposal.venueId, level: proposal.level },
          auth,
          "pal",
        );
        if (!result.ok && result.needsSignIn) {
          window.location.assign("/login?mode=signin&from=/pal/chat");
          return;
        }
        if (!result.ok) {
          setEntries((prev) => [
            ...prev,
            { kind: "error", id: nextId(), message: result.error },
          ]);
          return;
        }
        const level = result.reading.now ?? proposal.level;
        const age = result.reading.ageMinutes ?? 0;
        setEntries((prev) => [
          ...prev,
          {
            kind: "answer",
            id: nextId(),
            answer: {
              status: "answered",
              message: occupancyReceiptLine(level, age),
              cards: [],
            },
            locality: null,
            proposals: [],
            recall: null,
          },
        ]);
        if (entryId) dismissProposal(entryId, proposal.id);
      })();
    }
  }, [auth, dismissProposal, nextId, openVenue]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void ask(query);
    },
    [ask, query],
  );

  // Vibe deep link (?ask=...): a Tonight vibe chip can hand its preset ask to
  // this surface pre-fired. Read from location once on mount — a client-only,
  // fire-once concern, so plain location.search avoids wrapping the page in a
  // useSearchParams Suspense boundary. The ref (not `pending`) guards double
  // fire under StrictMode re-mounts.
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (autoAskedRef.current) return;
    autoAskedRef.current = true;
    const preset = new URLSearchParams(window.location.search).get("ask");
    const text = preset?.trim() ?? "";
    if (!text || text.length > 500) return;
    // Defer out of the effect body (React 19 idiom, as TonightClient's
    // settle()): ask() sets state, which must not run synchronously here.
    const timer = setTimeout(() => void ask(text), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  const empty = entries.length === 0 && !pending;
  // Tonight-at-a-glance data: the same /api/whats-on spine the map fetches,
  // enabled only while the transcript is empty (one light fetch; the glance
  // leaves the moment the conversation starts).
  const glance = useWhatsOnTonight(empty);
  const glanceLine = useMemo(
    () => tonightGlanceLine(countTonightKinds(glance.rows)),
    [glance.rows],
  );

  // Cheapest-pint glance row (judge-w2 polish item 1): the second honest value
  // row for the first-open gap. One slim-index load while the transcript is
  // empty, ranked from the remembered patch (or central London) through the
  // SAME rankNearMe answer Near me serves. Silent on any failure — the glance
  // never apologises.
  const [cheapest, setCheapest] = useState<{
    areaLabel: string;
    card: CheapestGlanceCard;
  } | null>(null);
  useEffect(() => {
    if (!empty || cheapest) return;
    let alive = true;
    void loadSlimVenuesForCity(DEFAULT_CITY_ID)
      .then((slim) => {
        if (!alive || slim.length === 0) return;
        const remembered = readRememberedArea();
        const patch =
          (remembered?.kind === "patch" ? resolveNightPatch(remembered.id) : null) ??
          CENTRAL_PATCH;
        const answer = rankNearMe(patch.lat, patch.lng, slim);
        const card = answer.cards[0];
        if (!card) return;
        setCheapest({
          areaLabel: patch.label,
          card: {
            name: card.name,
            cheapestPrice: card.cheapestPrice,
            walkMinutes: card.walkMinutes ?? null,
          },
        });
      })
      .catch(() => {
        // Slim index unavailable: render nothing, the ask path owns honesty.
      });
    return () => {
      alive = false;
    };
  }, [empty, cheapest]);
  const cheapestLine = useMemo(
    () => (cheapest ? cheapestGlanceLine(cheapest.areaLabel, cheapest.card, formatPrice) : null),
    [cheapest],
  );

  return (
    <>
      <SiteNav />
      <main id="main" className="palChat">
      <header className="palChatHead">
        {palHandoff ? (
          <Link className="palChatBack" href="/pal">
            ← Pub Pal
          </Link>
        ) : null}
        <p className="palChatEyebrow">
          <PubPalMascot size={18} circular />
          Ask your Pub Pal
        </p>
        <h1 className="palChatTitle">{"What's the night?"}</h1>
        <p className="palChatIntro">
          Straight answers from what we have actually seen. Every card keeps its
          source. No made-up venues, prices, or events.
        </p>
      </header>

      <div className="palChatScroll" ref={scrollRef}>
        <div className="palChatTranscript" aria-live="polite">
          {entries.map((entry) => {
            if (entry.kind === "user") {
              return (
                <div key={entry.id} className="palChatRow palChatRow--user">
                  <p className="palChatBubble palChatBubble--user">{entry.text}</p>
                </div>
              );
            }
            if (entry.kind === "error") {
              return (
                <div key={entry.id} className="palChatRow palChatRow--pal">
                  <p
                    className="palChatBubble palChatBubble--error"
                    role="alert"
                  >
                    {entry.message}
                  </p>
                </div>
              );
            }
            const { answer, locality, proposals, recall } = entry;
            return (
              <div key={entry.id} className="palChatRow palChatRow--pal">
                <p
                  className={`palChatBubble${
                    answer.status === "empty" ? " palChatBubble--empty" : ""
                  }`}
                >
                  {answer.message}
                </p>
                {recall ? (
                  <p className="palChatRecall" role="note">
                    {recall.line}
                  </p>
                ) : null}
                {palHandoff && locality ? (
                  <p className="palChatLocality" role="note">
                    {palLocalityLine(locality)}
                  </p>
                ) : null}
                {proposals.length > 0 ? (
                  <ul className="palChatProposals" aria-label="Suggested actions">
                    {proposals.map((proposal) => (
                      <li key={proposal.id} className="palChatProposal">
                        {proposal.kind === "draft_plan" ? (
                          <IntentLink
                            className="palChatPlanHandoff pressable"
                            href={planPalRouteHandoffHref(proposal.query)}
                            onClick={() => {
                              trackEvent("concierge_result_tap");
                              writeAskPlanDraft({
                                query: proposal.query,
                                stopIds: proposal.stopIds,
                                stopNames: proposal.stopNames,
                                createdAt: new Date().toISOString(),
                              });
                            }}
                          >
                            Open in Plan
                          </IntentLink>
                        ) : (
                          <button
                            type="button"
                            className="palChatProposalConfirm pressable"
                            onClick={() => confirmProposal(proposal, entry.id)}
                          >
                            {proposal.label}
                          </button>
                        )}
                        <button
                          type="button"
                          className="palChatProposalDismiss pressable"
                          onClick={() => dismissProposal(entry.id, proposal.id)}
                        >
                          Dismiss
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {answer.cards.length > 0 ? (
                  <ul className="palChatCards">
                    {answer.cards.map((card) => (
                      <AnswerCard
                        key={card.key}
                        card={card}
                        onOpen={openVenue}
                        knownVenueIds={knownVenueIds}
                        palHandoff={palHandoff}
                        locality={locality}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}

          {pending ? (
            <div className="palChatRow palChatRow--pal">
              <p className="palChatBubble palChatBubble--pending">
                <span className="palChatDots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="palChatSr">Checking what is on record</span>
              </p>
            </div>
          ) : null}
        </div>

        {empty ? (
          /* Vibe quick-asks (docs/VIBE_LAYER_SPEC_2026-07-19.md): the chip
             label is the user's voice; the press fires the chip's parser-tuned
             preset through the same deterministic ask path as typed text. */
          <VibeChips shellClassName="palChatExamples" groupLabel="Pick a vibe">
            {VIBE_CHIPS.map((chip) => (
              <VibeChipButton
                key={chip.id}
                onClick={() => {
                  trackEvent("tonight_vibe_select", { vibe: chip.id });
                  void ask(chip.ask);
                }}
              >
                {chip.label}
              </VibeChipButton>
            ))}
          </VibeChips>
        ) : null}

        {/* Tonight at a glance (judge-w1 wave 2): real spine counts fill the
            first-open dead zone with receipts. Renders only before the first
            ask; an outage renders nothing (the glance never apologises — the
            ask path owns error honesty when the user actually asks). */}
        {empty && glance.status === "ready" && glanceLine ? (
          <div className="palGlance" role="note" aria-label="Tonight at a glance">
            <span className="palGlanceLabel">
              <Sparkles size={13} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">{glanceLine}</p>
          </div>
        ) : null}
        {empty && glance.status === "empty" ? (
          <div className="palGlance" role="note" aria-label="Tonight at a glance">
            <span className="palGlanceLabel">
              <Sparkles size={13} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">
              {GLANCE_QUIET_LINE}{" "}
              <Link className="palGlanceExit" href={`/map/${DEFAULT_CITY_ID}`}>
                {GLANCE_QUIET_EXIT}
              </Link>
            </p>
          </div>
        ) : null}

        {/* Cheapest-pint row (judge-w2 polish item 1): same rankNearMe answer
            Near me serves, from the remembered patch. Absent = renders nothing. */}
        {empty && cheapestLine ? (
          <div className="palGlance" role="note" aria-label="Cheapest pint nearby">
            <span className="palGlanceLabel">
              <MapPin size={13} aria-hidden="true" /> Cheapest
            </span>
            <p className="palGlanceLine">
              {cheapestLine}{" "}
              <Link className="palGlanceExit" href="/near">
                See the list.
              </Link>
            </p>
          </div>
        ) : null}
      </div>

      <form className="palChatComposer" onSubmit={onSubmit}>
        <label className="palChatSr" htmlFor={inputId}>
          Describe the outing
        </label>
        <input
          id={inputId}
          className="palChatInput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quiet-ish near Bank, not pricey"
          maxLength={500}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className="palChatSend pressable"
          disabled={pending || !query.trim()}
          aria-label="Ask"
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </form>
      </main>
    </>
  );
}
