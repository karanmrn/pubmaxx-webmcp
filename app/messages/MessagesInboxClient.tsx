"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";

import "./messages.css";

// The messaging inbox (PRD E4 / Wave I2): conversations for the signed-in
// linked actor. Bearer via authedActionFetch; unsigned viewers get a sign-in prompt.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 20_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

/**
 * What the empty thread pane says, decided by the LIVE session.
 *
 * The pane used to be server-rendered copy: "Choose someone from your inbox to
 * read the thread and reply." A page may not server-render per-account content
 * (the client-router-cache law), so it could not know it was saying that to
 * somebody with no account and therefore no inbox to choose from. It reads the
 * session here instead, the way every other surface that names or routes the
 * viewer does, and it says nothing at all until that session answers.
 */
export function MessagesThreadEmptyCopy(): React.JSX.Element | null {
  const viewerSession = useViewerSession();

  if (viewerSession.unresolved) return null;

  if (viewerSession.signedOut) {
    return (
      <div>
        <p className="messagesThreadEyebrow">Messages</p>
        <h2>Your conversations show here.</h2>
        <p>One thread for each person you go out with, kept to the two of you.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="messagesThreadEyebrow">Your conversations</p>
      <h2>Pick a message</h2>
      <p>Choose someone from your inbox to read the thread and reply.</p>
    </div>
  );
}

export default function MessagesInboxClient({
  activeConversationId,
}: {
  activeConversationId?: string;
}): React.JSX.Element {
  const { accountRevision, user, handle: authHandle } = useAuth();
  const viewerSession = useViewerSession();
  const [handle, setHandle] = useState("");
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const accountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const fromAuth = normalizeHandle(authHandle ?? "");
      setHandle(fromAuth || readHandle());
    });
    return () => {
      active = false;
    };
  }, [authHandle]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const requestRevision = accountRevision;
      if (requestRevision !== accountRevisionRef.current) return;
      const stillCurrent = () => requestRevision === accountRevisionRef.current;
      if (!user) {
        if (!stillCurrent()) return;
        setConversations([]);
        setNeedsSignIn(true);
        setFailed(false);
        setLoadedRevision(requestRevision);
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (h !== handle && stillCurrent()) setHandle(h);
      if (!h) {
        if (!stillCurrent()) return;
        setConversations([]);
        setNeedsSignIn(true);
        setFailed(false);
        setLoadedRevision(requestRevision);
        return;
      }
      try {
        const res = await authedActionFetch(`/api/messages?handle=${encodeURIComponent(h)}`, {
          signal,
        });
        if (!stillCurrent()) {
          discardBody(res);
          return;
        }
        if (res.status === 401) {
          discardBody(res);
          setNeedsSignIn(true);
          setConversations([]);
          setFailed(false);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setNeedsSignIn(false);
          setFailed(true);
          return;
        }
        setNeedsSignIn(false);
        setFailed(false);
        const body = (await res.json()) as { conversations?: ConversationDTO[] };
        if (!stillCurrent()) return;
        setConversations(Array.isArray(body.conversations) ? body.conversations : []);
      } catch (err) {
        const aborted =
          signal?.aborted || (err instanceof Error && err.name === "AbortError");
        if (!aborted && stillCurrent()) {
          setNeedsSignIn(false);
          setFailed(true);
        }
      } finally {
        if (stillCurrent()) setLoadedRevision(requestRevision);
      }
    },
    [accountRevision, handle, user, authHandle],
  );

  const retry = useCallback(() => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    void refresh().finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [refresh]);

  const retryButton = (
    <button
      type="button"
      className="threadRetryBtn"
      onClick={retry}
      aria-busy={retrying || undefined}
    >
      {retrying ? "Trying again" : "Try again"}
    </button>
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh, handle]);

  const accountDataReady = loadedRevision === accountRevision;

  return (
    <>
      <h1 className="messagesHeading">Messages</h1>
      <p className="messagesCourtesyNote">
        Messages need a signed-in account. Keep it low-key, and report anything off.
      </p>

      {!accountDataReady ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : viewerSession.unresolved ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : viewerSession.signedOut && (needsSignIn || !user) ? (
        <EmptyState
          title="Sign in to message"
          body="Private messages need a signed-in account, so each message is tied to the right handle."
          action={<SignInButton />}
        />
      ) : failed && conversations.length === 0 ? (
        <EmptyState
          title="Couldn&rsquo;t load your conversations."
          role="alert"
          action={retryButton}
        />
      ) : conversations.length === 0 ? (
        <EmptyState
          title="Nobody in here yet."
          body="Find someone worth a pint on the feed, open their profile, and tap Message. That's how a round starts."
          action={<Link href="/social">Find someone to message</Link>}
        />
      ) : (
        <>
          {failed ? (
            <p className="inboxStaleNotice" role="status">
              <span>Couldn&rsquo;t refresh this list. It shows what loaded last.</span>
              {retryButton}
            </p>
          ) : null}
          <ul className="conversationList">
            {conversations.map((c) => {
              const active = c.id === activeConversationId;
              return (
                <li
                  key={c.id}
                  className={
                    active ? "conversationItem conversationItemActive" : "conversationItem"
                  }
                >
                  <Link
                    href={`/messages/${encodeURIComponent(c.id)}`}
                    className="conversationLink"
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="conversationBody">
                      <div className="conversationHandle">@{c.otherHandle}</div>
                      <div className="conversationPreview">
                        {c.lastBody
                          ? `${c.lastFromMe ? "You: " : ""}${c.lastBody}`
                          : "No messages yet"}
                      </div>
                    </div>
                    {c.unread > 0 ? (
                      <span className="conversationUnread" aria-label={`${c.unread} unread`}>
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
