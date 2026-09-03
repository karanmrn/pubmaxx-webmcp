"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Copy, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { writeActiveRoundCode } from "@/lib/activeRound";
import { normalizeHandle } from "@/lib/profiles";
import {
  captureRoundRequestIdentity,
  roundHandleForIdentity,
  roundRequestIdentityOwnerKey,
  runRoundMutationForCurrentUser,
  writeRoundAnonymousHandle,
} from "@/lib/roundRequest";
import { startRoundWithStops, type SeedStop } from "@/lib/startRoundWithStops";

import "./roundStarter.css";

function localStorageSafe(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type RoundStarterProps = {
  defaultTitle?: string;
  seedStops?: SeedStop[];
  /** Denser UI for the Plan drawer. */
  compact?: boolean;
  /**
   * When true, stay on the map after start (success UI + callback) instead of
   * navigating to `/rounds/{code}`. Defaults to `true` when `compact`.
   */
  stayOnMap?: boolean;
  /** Fires after a successful start when staying on the map (chip can light immediately). */
  onRoundStarted?: (code: string) => void;
  className?: string;
};

/**
 * Start a Round: group-crawl entry (GH #26). Mints a Round, optionally seeds
 * stops from a Plan route, stamps the active Round key, and either navigates
 * to the live Round page or (Plan drawer / stayOnMap) keeps the user on the map.
 */
export default function RoundStarter({
  defaultTitle,
  seedStops,
  compact = false,
  stayOnMap,
  onRoundStarted,
  className,
}: RoundStarterProps): React.JSX.Element {
  const router = useRouter();
  const {
    user,
    session,
    loading: authLoading,
    handle: accountHandle,
    getCurrentUserId,
  } = useAuth();
  const roundIdentity = useMemo(
    () =>
      authLoading
        ? null
        : captureRoundRequestIdentity(user?.id ?? null, session),
    [authLoading, session, user?.id],
  );
  const roundOwnerKey = roundRequestIdentityOwnerKey(roundIdentity);
  const stateOwnerRef = useRef<string | null>(null);
  const stay = stayOnMap ?? compact;
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedCode, setStartedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ownerChanged = stateOwnerRef.current !== roundOwnerKey;
    stateOwnerRef.current = roundOwnerKey;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (ownerChanged) {
        setBusy(false);
        setError(null);
        setStartedCode(null);
        setCopied(false);
      }
      setHandle(
        roundHandleForIdentity(
          roundIdentity,
          accountHandle,
          localStorageSafe(),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [accountHandle, roundIdentity, roundOwnerKey]);

  const hasSeeds = Boolean(seedStops && seedStops.length > 0);

  async function copyCode(code: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(
        offlineOrMessage("Could not copy Round code. Try again.")
      );
    }
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeHandle(handle);
    if (!clean) {
      setError("Pick a handle to start a Round.");
      return;
    }
    if (!roundIdentity) {
      setError("Your sign-in changed. Try again.");
      return;
    }
    setBusy(true);
    setError(null);
    const completion = await runRoundMutationForCurrentUser(
      roundIdentity,
      getCurrentUserId,
      () =>
        startRoundWithStops({
          handle: clean,
          identity: roundIdentity,
          title: defaultTitle,
          seedStops,
        }),
    );
    if (!completion.current) return;
    const result = completion.value;

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    writeRoundAnonymousHandle(roundIdentity, clean, localStorageSafe());
    writeActiveRoundCode(result.code);

    if (stay) {
      setStartedCode(result.code);
      setBusy(false);
      onRoundStarted?.(result.code);
      return;
    }

    router.push(`/rounds/${result.code}`);
  }

  const formClass = ["roundStarter", compact ? "compact" : null, className]
    .filter(Boolean)
    .join(" ");

  if (startedCode) {
    return (
      <div className={`${formClass} roundStarterSuccess`} role="status" aria-live="polite">
        <span className="roundStarterBadge">
          <Users size={14} aria-hidden="true" /> Round is live
        </span>
        <h2 className="roundStarterTitle">Share the code</h2>
        <p className="roundStarterBlurb">
          Friends join with this code. You stay on the map. Open the Round board anytime.
        </p>
        <p className="roundStarterCode" data-testid="round-starter-code">
          {startedCode}
        </p>
        <div className="roundStarterRow">
          <button
            type="button"
            className="crawlPrimaryBtn"
            onClick={() => void copyCode(startedCode)}
          >
            <Copy size={16} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
          </button>
          <Link href={`/rounds/${startedCode}`} className="crawlPrimaryBtn roundStarterBoardLink">
            Open Round board
          </Link>
        </div>
        {error ? <p role="status">{error}</p> : null}
      </div>
    );
  }

  return (
    <form className={formClass} onSubmit={start}>
      <span className="roundStarterBadge">
        <Users size={14} aria-hidden="true" /> The Round · group crawl
      </span>
      <h2 className="roundStarterTitle">
        {hasSeeds ? "Invite friends to this plan" : "Start a Round"}
      </h2>
      <p className="roundStarterBlurb">
        {hasSeeds
          ? "Turn this plan into a Round. Friends join by a short code; stops are already queued."
          : "A group crawl that builds itself. Friends join by a short code; as everyone drops pints, the route grows itself, stop by stop."}
      </p>
      <div className="roundStarterRow">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your handle"
          aria-label="Your handle"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={30}
        />
        <button
          type="submit"
          className="crawlPrimaryBtn"
          disabled={busy || authLoading}
        >
          <Users size={16} aria-hidden="true" />{" "}
          {busy ? "Starting…" : hasSeeds ? "Start Round" : "Start a Round"}
        </button>
      </div>
      {error ? (
        <p className="roundStarterError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
