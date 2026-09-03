"use client";

// Night OS Ask on the map (ADR 0014). Grounded cards + propose-then-confirm
// chips over POST /api/ask. Venue taps and confirmed proposals apply through
// parent callbacks — never silent Plan or memory writes.

import { useCallback, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";

import { useAuth } from "@/components/auth/AuthProvider";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  createAskSession,
  writeAskPlanDraft,
  type AskCard,
} from "@/lib/conciergeAskClient";
import type { AskProposal } from "@/lib/ask/types";
import { confirmOccupancyProposal } from "@/components/map/useVenueOccupancy";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";


const EXAMPLE_PROMPTS = [
  "Quiet-ish near Bank, 4 of us",
  "Quiz tonight in Soho",
  "Tube delays right now",
  "Plan a crawl in Soho for 4",
] as const;

type AskState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "answered";
      message: string;
      cards: AskCard[];
      proposals: AskProposal[];
      responseStatus: "ready" | "degraded";
    }
  | { status: "error"; message: string };

type MapConciergeAskProps = {
  cityId: string;
  onSelectVenue: (venueId: string) => void;
  onFlyTo?: (lat: number, lng: number) => void;
};

export default function MapConciergeAsk({
  cityId,
  onSelectVenue,
  onFlyTo,
}: MapConciergeAskProps) {
  const { user, session } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [proposalError, setProposalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const expand = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const collapse = useCallback(() => {
    setOpen(false);
  }, []);

  useDismissOnEscape(open, collapse);

  const sessionRef = useRef<ReturnType<typeof createAskSession> | null>(null);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      sessionRef.current ??= createAskSession();
      setProposalError(null);
      setState({ status: "loading" });
      trackEvent("concierge_ask");
      const result = await sessionRef.current(text, cityId);
      if (result === null) return;
      setState(result);
    },
    [cityId],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void ask(query);
    },
    [ask, query],
  );

  const pickCard = useCallback(
    (card: AskCard) => {
      if (!card.venueId) return;
      trackEvent("concierge_result_tap");
      onSelectVenue(card.venueId);
      setOpen(false);
    },
    [onSelectVenue],
  );

  const dismissProposal = useCallback((proposalId: string) => {
    setState((prev) => {
      if (prev.status !== "answered") return prev;
      return {
        ...prev,
        proposals: prev.proposals.filter((p) => p.id !== proposalId),
      };
    });
  }, []);

  const confirmProposal = useCallback(
    (proposal: AskProposal) => {
      trackEvent("concierge_result_tap");
      if (proposal.kind === "open_venue") {
        onSelectVenue(proposal.venueId);
        setOpen(false);
        return;
      }
      if (proposal.kind === "fly_to") {
        onFlyTo?.(proposal.lat, proposal.lng);
        dismissProposal(proposal.id);
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
        setProposalError(null);
        void (async () => {
          const result = await confirmOccupancyProposal(
            { venueId: proposal.venueId, level: proposal.level },
            auth,
            "pal",
          );
          if (!result.ok && result.needsSignIn) {
            window.location.assign("/login?mode=signin&from=/map");
            return;
          }
          if (!result.ok) {
            // A refused report keeps its chip, so the reader can try again and
            // is never left believing an unsaved report landed.
            setProposalError(result.error);
            return;
          }
          dismissProposal(proposal.id);
        })();
      }
    },
    [auth, dismissProposal, onFlyTo, onSelectVenue],
  );

  if (!open) {
    return (
      <div className="mapConciergeAsk mapConciergeAsk--collapsed">
        <button
          type="button"
          className="mapConciergeAskPill pressable"
          onClick={expand}
          aria-expanded={false}
        >
          <PubPalMascot size={20} circular />
          <span>Ask your Pub Pal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mapConciergeAsk mapConciergeAsk--open">
      <section
        className="mapConciergeAskPanel"
        role="dialog"
        aria-label="Ask your Pub Pal"
      >
        <header className="mapConciergeAskHead">
          <span className="mapConciergeAskEyebrow">
            <PubPalMascot size={16} circular />
            Ask your Pub Pal
          </span>
          <button
            type="button"
            className="mapConciergeAskClose pressable"
            onClick={collapse}
            aria-label="Close ask"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="mapConciergeAskForm" onSubmit={onSubmit}>
          <label className="mapConciergeAskSr" htmlFor="map-concierge-query">
            Describe the outing
          </label>
          <input
            id="map-concierge-query"
            ref={inputRef}
            className="mapConciergeAskInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Quiet-ish near Bank, not pricey…"
            maxLength={500}
            enterKeyHint="search"
          />
          <button
            type="submit"
            className="mapConciergeAskGo pressable"
            disabled={state.status === "loading" || !query.trim()}
          >
            {state.status === "loading" ? "Asking…" : "Ask"}
          </button>
        </form>

        {state.status === "idle" ? (
          <div className="mapConciergeAskExamples" aria-label="Example asks">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="mapConciergeAskChip pressable"
                onClick={() => {
                  setQuery(prompt);
                  void ask(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {state.status === "error" ? (
          <p className="mapConciergeAskMsg mapConciergeAskMsg--error" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.status === "answered" ? (
          <div className="mapConciergeAskAnswer" role="status" aria-live="polite">
            <p className="mapConciergeAskMsg">{state.message}</p>
            {state.responseStatus === "degraded" ? (
              <p className="mapConciergeAskMsg mapConciergeAskMsg--degraded">
                Some live city facts could not be checked just now.
              </p>
            ) : null}
            {proposalError ? (
              <p className="mapConciergeAskMsg mapConciergeAskMsg--error">
                {proposalError}
              </p>
            ) : null}
            {state.proposals.length > 0 ? (
              <ul className="mapConciergeAskProposals" aria-label="Confirm an action">
                {state.proposals.map((proposal) => (
                  <li key={proposal.id} className="mapConciergeAskProposal">
                    <button
                      type="button"
                      className="mapConciergeAskProposalConfirm pressable"
                      onClick={() => confirmProposal(proposal)}
                    >
                      {proposal.label}
                    </button>
                    <button
                      type="button"
                      className="mapConciergeAskProposalDismiss pressable"
                      onClick={() => dismissProposal(proposal.id)}
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {state.cards.length > 0 ? (
              <ul className="mapConciergeAskList">
                {state.cards.map((card) => {
                  const tappable = Boolean(card.venueId);
                  const body = (
                    <>
                      <div className="mapConciergeAskCardTop">
                        <p className="mapConciergeAskCardTitle">{card.title}</p>
                        {typeof card.price === "number" ? (
                          <span className="mapConciergeAskCardPrice">
                            £{card.price.toFixed(2)}
                          </span>
                        ) : null}
                      </div>
                      {card.place ? (
                        <p className="mapConciergeAskCardPlace">
                          <MapPin size={12} aria-hidden="true" />
                          <span>{card.place}</span>
                        </p>
                      ) : null}
                      {card.note ? (
                        <p className="mapConciergeAskCardNote">{card.note}</p>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={card.key} className="mapConciergeAskCard">
                      {tappable ? (
                        <button
                          type="button"
                          className="mapConciergeAskCardTap pressable"
                          onClick={() => pickCard(card)}
                        >
                          {body}
                          <span className="mapConciergeAskCardCta" aria-hidden="true">
                            Show on map
                          </span>
                        </button>
                      ) : (
                        <div className="mapConciergeAskCardTap mapConciergeAskCardTap--static">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
