"use client";

// Your crews on /social: the nights you are in, and one way to start another.
//
// A crew is a night (lib/socialCrewsUi.ts owns why), so starting one is a plan
// create followed by a crew create. Both routes already exist and neither
// changes here: `/api/plans` returns the host capability in its reply body, and
// `/api/social/crews` takes it straight back as the Bearer it hashes. The two
// calls are chained in the browser because the host token is memory-only by
// design (lib/planSessionCapability.ts) and the plan member cookie is scoped to
// `/api/plans/<id>`, so no server seam can reach it from here.
//
// The panel renders a neutral identity state before it reads anything. Its
// parent owns the Social gate when it already has that answer; with the launch
// flag off, access resolves to `preview` and protected crew data stays absent.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  SOCIAL_CREW_VISIBILITIES,
  type SocialCrewListItemDTO,
  type SocialCrewVisibility,
} from "@/lib/socialCrew";
import { discardBody } from "@/lib/responseBody";
import {
  CREW_EMPTY_COPY,
  CREW_LIST_UNAVAILABLE_COPY,
  CREW_NAME_MAX,
  CREW_PHASE_LABEL,
  CREW_ROLE_LABEL,
  CREW_VISIBILITY_LABEL,
  CREW_WHAT_IT_IS,
  CREW_DEFAULT_VISIBILITY,
  cleanCrewName,
  crewIdempotencyKey,
  crewPath,
  crewStartsCaption,
  parseCrewListPage,
  parseCrewMutation,
  startCrewPlanBody,
} from "@/lib/socialCrewsUi";

import {
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";

import "./crews.css";

type ListState = "loading" | "ready" | "error";
type StartState = "idle" | "naming" | "working";

type VenueMatch = { id: string; name: string; borough?: string };

function defaultStartTime(now: Date = new Date()): string {
  // Tonight at 19:00 in the reader's own clock, or tomorrow once that has gone.
  const start = new Date(now);
  start.setHours(19, 0, 0, 0);
  if (start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
}

export default function CrewsPanel({
  viewerHandle,
  compact = false,
  resolveAccess = false,
}: {
  viewerHandle?: string | null;
  compact?: boolean;
  /**
   * Ask Social whether this reader is verified before rendering anything. A
   * parent that already gated its own subtree (SocialPageClient) leaves this
   * off; a card mounted somewhere ungated (the You profile) turns it on, so the
   * panel disappears entirely rather than painting an error where the launch
   * flag simply is not on.
   */
  resolveAccess?: boolean;
}) {
  const { identityResolved, user } = useAuth();
  const viewerPhase: SocialViewerPhase =
    !identityResolved ? "unresolved" : user ? "resolved" : "signed-out";
  const [gate, setGate] = useState<"checking" | "open" | "closed">(
    resolveAccess ? "checking" : "open",
  );
  const [status, setStatus] = useState<ListState>("loading");
  const [crews, setCrews] = useState<SocialCrewListItemDTO[]>([]);
  const [attempt, setAttempt] = useState(0);

  const [start, setStart] = useState<StartState>("idle");
  const [name, setName] = useState("");
  const [when, setWhen] = useState(defaultStartTime());
  const [visibility, setVisibility] = useState<SocialCrewVisibility>(
    CREW_DEFAULT_VISIBILITY,
  );
  const [venueQuery, setVenueQuery] = useState("");
  const [venues, setVenues] = useState<VenueMatch[]>([]);
  const [venue, setVenue] = useState<VenueMatch | null>(null);
  const [problem, setProblem] = useState("");
  const venueDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!resolveAccess || !identityResolved) return;
    if (!user) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authedActionFetch("/api/social/access", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          discardBody(response);
          setGate("closed");
          return;
        }
        const body = (await response.json()) as { state?: unknown };
        setGate(body.state === "verified" ? "open" : "closed");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGate("closed");
      }
    })();
    return () => controller.abort();
  }, [identityResolved, resolveAccess, user]);

  useEffect(() => {
    if (gate !== "open" || viewerPhase !== "resolved") return;
    const controller = new AbortController();
    void Promise.resolve().then(() => setStatus("loading"));
    authedActionFetch("/api/social/crews", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Crews unavailable");
        const page = parseCrewListPage(await response.json());
        if (!page) throw new Error("Crews malformed");
        return page;
      })
      .then((page) => {
        setCrews(page.items);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCrews([]);
        setStatus("error");
      });
    return () => controller.abort();
  }, [attempt, gate, viewerPhase]);

  useEffect(() => {
    if (venueDebounce.current) clearTimeout(venueDebounce.current);
    const query = venueQuery.trim();
    if (viewerPhase !== "resolved" || query.length < 2) {
      void Promise.resolve().then(() => setVenues([]));
      return () => {
        if (venueDebounce.current) clearTimeout(venueDebounce.current);
      };
    }
    const controller = new AbortController();
    venueDebounce.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await authedActionFetch(
            `/api/social/venues?q=${encodeURIComponent(query)}`,
            { cache: "no-store", credentials: "same-origin", signal: controller.signal },
          );
          if (!response.ok) {
            discardBody(response);
            setVenues([]);
            return;
          }
          const body = (await response.json()) as { venues?: VenueMatch[] };
          setVenues(Array.isArray(body.venues) ? body.venues : []);
        } catch {
          setVenues([]);
        }
      })();
    }, 220);
    return () => {
      controller.abort();
      if (venueDebounce.current) clearTimeout(venueDebounce.current);
    };
  }, [venueQuery, viewerPhase]);

  const startCrew = useCallback(async () => {
    if (start === "working") return;
    setProblem("");
    const body = startCrewPlanBody({
      name,
      startTime: when,
      hostName: viewerHandle ?? "",
      venue: venue ? { id: venue.id, name: venue.name } : { id: "", name: "" },
    });
    if (!body) {
      setProblem("Name the night, choose when it starts, and pick the first pub.");
      return;
    }
    setStart("working");
    try {
      const planKey = crewIdempotencyKey("crew-plan");
      const planResponse = await authedActionFetch("/api/plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": planKey },
        body: JSON.stringify(body),
      });
      const planBody = (await planResponse.json().catch(() => null)) as
        | { plan?: { plan?: { id?: string } }; memberToken?: string; error?: unknown }
        | null;
      const planId = planBody?.plan?.plan?.id;
      const memberToken = planBody?.memberToken;
      if (!planResponse.ok || typeof planId !== "string" || typeof memberToken !== "string") {
        throw new Error(errorMessageFrom(planBody, "Could not set the night up."));
      }

      const crewResponse = await authedActionFetch("/api/social/crews", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crewIdempotencyKey("crew-create"),
          authorization: `Bearer ${memberToken}`,
        },
        body: JSON.stringify({ planId, visibility }),
      });
      const crewBody = (await crewResponse.json().catch(() => null)) as
        | Record<string, unknown>
        | null;
      const outcome = parseCrewMutation(crewBody);
      if (!crewResponse.ok || !outcome?.crewId) {
        throw new Error(errorMessageFrom(crewBody, "Could not start the crew."));
      }

      setStart("idle");
      setName("");
      setVisibility(CREW_DEFAULT_VISIBILITY);
      setVenue(null);
      setVenueQuery("");
      setAttempt((value) => value + 1);
    } catch (error) {
      setStart("naming");
      setProblem(error instanceof Error ? error.message : "Could not start the crew.");
    }
  }, [name, start, venue, viewerHandle, visibility, when]);

  const cleanName = cleanCrewName(name);

  if (viewerPhase !== "resolved") {
    return (
      <section
        className={compact ? "crews crews--compact" : "crews"}
        aria-labelledby="crews-title"
      >
        <h2 id="crews-title" className="crews__title">
          Your crews
        </h2>
        <SocialViewerState
          phase={viewerPhase}
          loadingLabel="Loading your crews"
          inviteMessage="See your crews."
        />
      </section>
    );
  }

  // Closed gate renders nothing at all. A "Social is in preview" line here
  // would be a second, quieter promise of crews on a surface that never
  // offered them.
  if (gate !== "open") return null;

  return (
    <section
      className={compact ? "crews crews--compact" : "crews"}
      aria-labelledby="crews-title"
    >
      <h2 id="crews-title" className="crews__title">
        Your crews
      </h2>

      {status === "loading" ? (
        <div className="crews__skeletons" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : status === "error" ? (
        <div className="crews__notice" role="alert">
          <p>{CREW_LIST_UNAVAILABLE_COPY}</p>
          <button
            type="button"
            className="crews__button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : crews.length === 0 ? (
        <p className="crews__empty" role="status">
          {CREW_EMPTY_COPY}
        </p>
      ) : (
        <ul className="crews__list">
          {crews.map((crew) => {
            const starts = crewStartsCaption(crew.startsAt);
            return (
              <li key={crew.crewId} className="crews__row">
                <Link className="crews__rowLink" href={crewPath(crew.crewId)}>
                  <span className="crews__rowName">{crew.title}</span>
                  <span className="crews__rowMeta">
                    <span className={`crews__phase crews__phase--${crew.phase}`}>
                      {CREW_PHASE_LABEL[crew.phase]}
                    </span>
                    {crew.nightArea ? <span>{crew.nightArea}</span> : null}
                    {starts ? (
                      <time dateTime={crew.startsAt}>{starts}</time>
                    ) : null}
                  </span>
                </Link>
                <span className="crews__role">{CREW_ROLE_LABEL[crew.viewer.role]}</span>
              </li>
            );
          })}
        </ul>
      )}

      {start === "idle" ? (
        <div className="crews__startBlock">
          <button
            type="button"
            className="crews__button crews__button--primary"
            onClick={() => setStart("naming")}
          >
            Start a crew
          </button>
          <p className="crews__note">{CREW_WHAT_IT_IS}</p>
        </div>
      ) : (
        <form
          className="crews__form"
          onSubmit={(event) => {
            event.preventDefault();
            void startCrew();
          }}
        >
          <label className="crews__field">
            <span>Name the night</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={CREW_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Friday in Soho"
            />
            <span className="crews__count" aria-live="polite">
              {cleanName.length}/{CREW_NAME_MAX}
            </span>
          </label>

          <label className="crews__field">
            <span>Starts</span>
            <input
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>

          <label className="crews__field">
            <span>First pub</span>
            <input
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={venue ? venue.name : venueQuery}
              placeholder="Search a pub"
              onChange={(event) => {
                setVenue(null);
                setVenueQuery(event.target.value);
              }}
            />
          </label>

          {!venue && venues.length > 0 ? (
            <ul className="crews__venueList">
              {venues.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    className="crews__venueOption"
                    onClick={() => {
                      setVenue(match);
                      setVenues([]);
                    }}
                  >
                    <span>{match.name}</span>
                    {match.borough ? <small>{match.borough}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <fieldset className="crews__visibility">
            <legend>Who can join?</legend>
            <div className="crews__visibilityOptions">
              {SOCIAL_CREW_VISIBILITIES.map((option) => (
                <label className="crews__visibilityOption" key={option}>
                  <input
                    type="radio"
                    name="visibility"
                    value={option}
                    checked={visibility === option}
                    onChange={() => setVisibility(option)}
                  />
                  <span>{CREW_VISIBILITY_LABEL[option]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {problem ? (
            <p className="crews__problem" role="alert">
              {problem}
            </p>
          ) : null}

          <div className="crews__formActions">
            <button
              type="submit"
              className="crews__button crews__button--primary"
              disabled={start === "working"}
            >
              {start === "working" ? "Starting…" : "Start the crew"}
            </button>
            <button
              type="button"
              className="crews__button"
              disabled={start === "working"}
              onClick={() => {
                setStart("idle");
                setProblem("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
