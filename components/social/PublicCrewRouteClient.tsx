"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SiteNav from "@/components/nav/SiteNav";
import PublicCrewPreview, {
  type PublicCrewJoinState,
} from "@/components/social/PublicCrewPreview";
import CrewDetailClient from "@/app/social/crews/[crewId]/CrewDetailClient";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { providerHasAnswered } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";
import { parseCrewRead, parsePublicCrewPreview, crewIdempotencyKey } from "@/lib/socialCrewsUi";
import { socialBoundaryCopy } from "@/lib/socialLaunch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import type {
  SocialCrewPublicPreviewDTO,
  SocialCrewReadDTO,
} from "@/lib/socialCrew";

import "@/components/social/crews.css";

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

function crewAuthScope(
  crewId: string,
  identityKey: string,
  identityResolved: boolean,
): string {
  return `${crewId}:${identityKey}:${identityResolved ? "resolved" : "unresolved"}`;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav active="social" />
      <main className="crewPage" id="main-content">
        <Link className="crewPage__back" href="/social">
          Back to Social
        </Link>
        {children}
      </main>
    </>
  );
}

function RollbackPreview() {
  return (
    <Shell>
      <section className="crews__notice" role="status">
        <h1>{socialBoundaryCopy("preview", false)}</h1>
      </section>
    </Shell>
  );
}

export default function PublicCrewRouteClient({
  crewId,
  invitationId,
}: {
  crewId: string;
  invitationId: string | null;
}) {
  const { accountRevision, identityResolved, providerAuthState } = useAuth();
  const friendsLaunchEnabled = useSocialFriendsLaunch();
  const scope = crewAuthScope(crewId, String(accountRevision), identityResolved);
  const [publicState, setPublicState] = useState<LoadState>("idle");
  const [publicPreview, setPublicPreview] = useState<SocialCrewPublicPreviewDTO | null>(null);
  const [privateState, setPrivateState] = useState<LoadState>("idle");
  const [privateRead, setPrivateRead] = useState<SocialCrewReadDTO | null>(null);
  const [privateStateScope, setPrivateStateScope] = useState<string | null>(null);
  const [privateReadScope, setPrivateReadScope] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<PublicCrewJoinState>("none");
  const [joinScope, setJoinScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [problemScope, setProblemScope] = useState<string | null>(null);
  const crewGeneration = useRef(0);
  const scopeGeneration = useRef(0);
  const scopeRef = useRef(scope);
  const joinKey = useRef<{ scope: string; key: string } | null>(null);

  // A public preview may remain visible through an auth transition, but every
  // private read and join response belongs to one exact crew/account answer.
  // The scope marker also keeps a member response from rendering while the
  // current provider identity is unresolved.
  useEffect(() => {
    scopeRef.current = scope;
    const version = scopeGeneration.current + 1;
    scopeGeneration.current = version;
    joinKey.current = null;
    void Promise.resolve().then(() => {
      if (scopeGeneration.current !== version || scopeRef.current !== scope) return;
      setPrivateRead(null);
      setPrivateState("idle");
      setPrivateStateScope(null);
      setJoinState("none");
      setJoinScope(null);
      setBusy(false);
      setBusyScope(null);
      setProblem("");
      setProblemScope(null);
    });
  }, [scope]);

  useEffect(() => {
    if (!friendsLaunchEnabled) return;
    const generation = crewGeneration.current + 1;
    crewGeneration.current = generation;
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || crewGeneration.current !== generation) return;
      setPublicPreview(null);
      setPublicState("loading");
    });
    fetch(`/api/social/crews/${encodeURIComponent(crewId)}/public`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          discardBody(response);
          return "missing" as const;
        }
        if (!response.ok) {
          discardBody(response);
          throw new Error("Public crew unavailable");
        }
        const preview = parsePublicCrewPreview(await response.json());
        if (!preview) throw new Error("Public crew malformed");
        return preview;
      })
      .then((result) => {
        if (!active || crewGeneration.current !== generation) return;
        if (result === "missing") {
          setPublicPreview(null);
          setPublicState("missing");
          return;
        }
        if (result.crewId !== crewId) throw new Error("Public crew identity changed");
        setPublicPreview(result);
        setPublicState("ready");
      })
      .catch((error: unknown) => {
        if (
          !active ||
          crewGeneration.current !== generation ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setPublicPreview(null);
        setPublicState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [crewId, friendsLaunchEnabled]);

  useEffect(() => {
    if (!friendsLaunchEnabled) return;
    const generation = scopeGeneration.current;
    if (providerAuthState !== "authenticated") {
      void Promise.resolve().then(() => {
        if (scopeGeneration.current !== generation || scopeRef.current !== scope) return;
        setPrivateRead(null);
        setPrivateState("idle");
        setPrivateStateScope(scope);
      });
      return;
    }
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || scopeGeneration.current !== generation || scopeRef.current !== scope) {
        return;
      }
      setPrivateState("loading");
      setPrivateStateScope(scope);
    });
    authedActionFetch(`/api/social/crews/${encodeURIComponent(crewId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          discardBody(response);
          return "missing" as const;
        }
        if (!response.ok) {
          discardBody(response);
          throw new Error("Protected crew unavailable");
        }
        const read = parseCrewRead(await response.json());
        if (!read) throw new Error("Protected crew malformed");
        return read;
      })
      .then((result) => {
        if (
          !active ||
          scopeGeneration.current !== generation ||
          scopeRef.current !== scope
        ) {
          return;
        }
        if (result === "missing") {
          setPrivateRead(null);
          setPrivateState("missing");
          setPrivateStateScope(scope);
          setPrivateReadScope(null);
          return;
        }
        setPrivateRead(result);
        setPrivateState("ready");
        setPrivateStateScope(scope);
        setPrivateReadScope(scope);
        if (result.kind === "preview") {
          setJoinState(result.joinRequestState);
          setJoinScope(scope);
        }
      })
      .catch((error: unknown) => {
        if (
          !active ||
          scopeGeneration.current !== generation ||
          scopeRef.current !== scope ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setPrivateRead(null);
        setPrivateState("error");
        setPrivateStateScope(scope);
        setPrivateReadScope(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountRevision, crewId, friendsLaunchEnabled, identityResolved, providerAuthState, scope]);

  async function askToJoin(): Promise<void> {
    if (!friendsLaunchEnabled) return;
    const operationScope = scopeRef.current;
    const operationGeneration = scopeGeneration.current;
    const currentPreview = publicPreview?.crewId === crewId ? publicPreview : null;
    if (
      (busy && busyScope === operationScope) ||
      !currentPreview ||
      operationScope !== scope ||
      scopeGeneration.current !== operationGeneration
    ) {
      return;
    }
    setBusy(true);
    setBusyScope(operationScope);
    setProblem("");
    setProblemScope(operationScope);
    try {
      if (!joinKey.current || joinKey.current.scope !== operationScope) {
        joinKey.current = {
          scope: operationScope,
          key: crewIdempotencyKey("crew-public-join"),
        };
      }
      const response = await authedActionFetch(
        `/api/social/crews/${encodeURIComponent(crewId)}/join-requests`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": joinKey.current.key,
          },
          body: "{}",
        },
      );
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(errorMessageFrom(body, "That did not go through."));
      if (
        scopeRef.current !== operationScope ||
        scopeGeneration.current !== operationGeneration
      ) {
        return;
      }
      setJoinState("pending");
      setJoinScope(operationScope);
    } catch (error) {
      if (
        scopeRef.current !== operationScope ||
        scopeGeneration.current !== operationGeneration
      ) {
        return;
      }
      setProblem(error instanceof Error ? error.message : "That did not go through.");
      setProblemScope(operationScope);
    } finally {
      if (
        scopeRef.current === operationScope &&
        scopeGeneration.current === operationGeneration
      ) {
        setBusy(false);
        setBusyScope(operationScope);
      }
    }
  }

  const currentPreview = publicPreview?.crewId === crewId ? publicPreview : null;
  const currentPrivateRead = privateReadScope === scope ? privateRead : null;
  const currentPrivateState = privateStateScope === scope ? privateState : "idle";
  const currentJoinState = joinScope === scope ? joinState : "none";
  const currentBusy = busyScope === scope && busy;
  const currentProblem = problemScope === scope ? problem : "";
  if (!friendsLaunchEnabled) return <RollbackPreview />;
  const privateReadPending =
    !providerHasAnswered(providerAuthState) ||
    (providerAuthState === "authenticated" &&
      (privateStateScope !== scope ||
        currentPrivateState === "idle" ||
        currentPrivateState === "loading"));

  // Preserve existing authenticated invitation behaviour even when the same
  // crew also has an account-free public preview. CrewDetailClient owns the
  // invitation accept/decline seam.
  if (currentPrivateRead && invitationId) {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  if (currentPrivateRead?.kind === "member") {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  if (!privateReadPending && currentPreview) {
    return (
      <Shell>
        <PublicCrewPreview
          preview={currentPreview}
          joinState={currentJoinState}
          busy={currentBusy}
          problem={currentProblem}
          onAskToJoin={() => void askToJoin()}
        />
      </Shell>
    );
  }

  if (currentPrivateRead) {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  if (
    publicState === "loading" ||
    (!publicPreview && publicState === "idle") ||
    privateReadPending
  ) {
    return (
      <Shell>
        <div className="crews__skeletons" aria-hidden="true">
          <span />
          <span />
        </div>
      </Shell>
    );
  }

  if (
    publicState === "missing" &&
    (providerAuthState !== "authenticated" ||
      (privateStateScope === scope && currentPrivateState === "missing"))
  ) {
    return (
      <Shell>
        <section className="crews__notice" role="status">
          <h1>This crew is not open to you.</h1>
          <Link className="crews__button" href="/social">
            Back to Social
          </Link>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="crews__notice" role="alert">
        <h1>Could not load this crew.</h1>
        <button
          type="button"
          className="crews__button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </section>
    </Shell>
  );
}
