"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import MessageAttachmentPicker, {
  type MessageAttachKind,
  type MessageAttachmentPickerHandle,
} from "@/components/messages/MessageAttachmentPicker";
import MessagePhoto from "@/components/messages/MessagePhoto";
import MessageVenueCard from "@/components/messages/MessageVenueCard";
import MessageVenuePicker, {
  type PickedVenue,
} from "@/components/messages/MessageVenuePicker";
import { authedActionFetch } from "@/lib/authedFetch";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import { discardBody } from "@/lib/responseBody";
import {
  MESSAGE_ATTACH_PHOTO_LABEL,
  MESSAGE_ATTACH_PHOTO_SHORT,
  MESSAGE_ATTACH_VENUE_LABEL,
  MESSAGE_ATTACH_VENUE_SHORT,
  MESSAGE_PHOTO_CROP_TARGET,
  MESSAGE_PHOTO_FAILED_LINE,
} from "@/lib/messageAttachments";
import { linkifyMentions, MAX_MESSAGE_BODY, type MessageDTO } from "@/lib/messages";
import { subscribeToMessages } from "@/lib/messagesRealtime";
import { normalizeHandle } from "@/lib/profiles";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "@/app/messages/messages.css";

// The message thread (PRD E4): bubbles (mine right / category-brass tint, theirs
// left / plain panel), a composer with the 1000-char cap, and a light abuse
// "Report" affordance per received message. Live via realtime SIGNALS
// (subscribeToMessages) with a MANDATORY polling fallback — the payload is never
// rendered; every signal refetches through the participant-gated API so the
// courtesy check re-applies to every row.
//
// COURTESY-CURTAIN, NOT PRIVACY: the viewer's own self-asserted `pubmax_handle`
// decides which bubbles are "mine". A GET that isn't a participant returns 404 —
// the page below shows a friendly not-found rather than a leak.
//
// A BUBBLE'S WIDTH IS THE ROW'S BUSINESS. Each row wraps its bubble in a
// `.messageLine`, which is the box the 75% limit lives on; putting that limit on
// the bubble made every bubble 78% of its OWN natural width, and "Yo!!" arrived
// on production as one character per line. See app/messages/messages.css.
//
// A MESSAGE MAY CARRY ONE ATTACHMENT: a photo, or a pub. The photo takes the
// whole owned-image journey server-side and its bytes come back through the same
// courtesy gate the thread does (components/messages/MessagePhoto.tsx). The pub
// stores an id alone (no coordinate of any kind rides in a message) and its
// card is resolved live on the read path.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 10_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

/**
 * Whether Enter alone should SEND. A physical keyboard has a modifier to reach
 * for; a phone keyboard's return key is how a person starts a new line, so
 * hijacking it there would make a two-line message impossible to type. Read
 * once per mount and re-read when the pointer changes (a tablet with a keyboard
 * attached is both).
 */
function useEnterSends(): boolean {
  const [enterSends, setEnterSends] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: fine)");
    const apply = () => setEnterSends(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return enterSends;
}

function subscribeMobileViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

// Render a message body with @-mentions linkified to /u/<handle>. Pure segments
// from lib/messages — text as-is, mentions as brass links.
function MessageBody({ body }: { body: string }): React.JSX.Element {
  const segments = useMemo(() => linkifyMentions(body), [body]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <Link key={i} href={`/u/${encodeURIComponent(seg.handle)}`} className="messageMention">
            {seg.raw}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

type ThreadState = "loading" | "ready" | "notfound" | "signedout" | "unreachable";

type ThreadReadKey = {
  conversationId: string;
  accountRevision: number;
};

type ThreadReadRequest = ThreadReadKey & {
  generation: number;
};

function sameThreadReadKey(
  key: ThreadReadKey | null,
  conversationId: string,
  accountRevision: number,
): boolean {
  return key?.conversationId === conversationId && key?.accountRevision === accountRevision;
}

function sameThreadReadRequest(
  left: ThreadReadRequest | null,
  right: ThreadReadRequest,
): boolean {
  return (
    left?.conversationId === right.conversationId &&
    left.accountRevision === right.accountRevision &&
    left.generation === right.generation
  );
}

/** What is riding on the NEXT message. At most one, by design. */
type PendingAttachment =
  | { kind: "photo"; file: File; previewUrl: string }
  | { kind: "venue"; venue: PickedVenue };

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function MessageThread({
  conversationId,
}: {
  conversationId: string;
}): React.JSX.Element {
  const { accountRevision, user, handle: authHandle } = useAuth();
  // The phase settles once per boot, and the refresh below re-keys on it so a
  // thread that waited for the session reloads the moment it answers.
  const viewerSession = useViewerSession();
  const [handle, setHandle] = useState("");
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [otherHandle, setOtherHandle] = useState("");
  const [state, setState] = useState<ThreadState>("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [pickingVenue, setPickingVenue] = useState(false);
  const [mobileAttachOpen, setMobileAttachOpen] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const loadedForRef = useRef<ThreadReadKey | null>(null);
  const [viewRevision, setViewRevision] = useState<ThreadReadKey | null>(null);
  const activeReadRef = useRef<ThreadReadRequest | null>(null);
  const requestGenerationRef = useRef(0);
  const conversationIdRef = useRef(conversationId);
  const accountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    if (conversationIdRef.current === conversationId) return;
    activeReadRef.current = null;
    loadedForRef.current = null;
    setViewRevision(null);
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useLayoutEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);
  const attachmentPickerRef = useRef<MessageAttachmentPickerHandle | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cropCardRef = useRef<HTMLDivElement | null>(null);
  const enterSends = useEnterSends();
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );

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

  // The crop step declares itself modal, so it has to BE one: the rest of the
  // page goes inert, Tab cycles inside the card, Escape leaves, and focus lands
  // in the card rather than staying on the file input behind it. Without this a
  // keyboard reader tabbed straight out into the thread and composer beneath.
  const cropOpen = cropping !== null;
  useFocusTrap(cropOpen, cropCardRef);
  useDismissOnEscape(cropOpen, () => setCropping(null));
  useEffect(() => {
    if (!cropOpen) return;
    cropCardRef.current?.focus({ preventScroll: true });
  }, [cropOpen]);

  // Refetch the thread through the participant-gated API. A 404 = we're not a
  // participant (or the conversation is gone) → show not-found, never a leak.
  // Wave I2: 401 without sign-in -> signedout; Bearer via authedActionFetch.
  // A fetch that fails before THIS conversation has loaded lands on
  // "unreachable" so the loading line only ever stands for a load that is still
  // running; once this conversation HAS loaded, a failed poll keeps the messages
  // already on screen. The ref is keyed by id, not a bare flag: the thread pane
  // sits beside the inbox, so switching conversations reuses this instance.
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const requestRevision = accountRevision;
      if (requestRevision !== accountRevisionRef.current) return;
      const requestKey: ThreadReadKey = { conversationId, accountRevision: requestRevision };
      const request: ThreadReadRequest = {
        ...requestKey,
        generation: requestGenerationRef.current + 1,
      };
      requestGenerationRef.current = request.generation;
      activeReadRef.current = request;
      const stillCurrent = () =>
        !signal?.aborted &&
        sameThreadReadRequest(activeReadRef.current, request) &&
        conversationIdRef.current === requestKey.conversationId &&
        accountRevisionRef.current === requestKey.accountRevision;
      if (!user) {
        if (!stillCurrent()) return;
        loadedForRef.current = null;
        setViewRevision(viewerSession.unresolved ? null : requestKey);
        // The live session has not answered yet: a thread that cannot be read
        // is still loading. Calling it signed-out here showed a signed-in
        // drinker the sign-in door on their own conversation.
        setState(viewerSession.unresolved ? "loading" : "signedout");
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!h) {
        if (!stillCurrent()) return;
        loadedForRef.current = null;
        setViewRevision(requestKey);
        setState("signedout");
        return;
      }
      try {
        const res = await authedActionFetch(
          `/api/messages/${encodeURIComponent(conversationId)}?handle=${encodeURIComponent(h)}`,
          { signal },
        );
        if (!stillCurrent()) {
          discardBody(res);
          return;
        }
        if (res.status === 401) {
          discardBody(res);
          loadedForRef.current = null;
          setViewRevision(requestKey);
          setState("signedout");
          return;
        }
        if (res.status === 404) {
          discardBody(res);
          loadedForRef.current = null;
          setViewRevision(requestKey);
          setState("notfound");
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setViewRevision(requestKey);
          if (!sameThreadReadKey(loadedForRef.current, conversationId, requestRevision)) {
            setState("unreachable");
          }
          return;
        }
        const body = (await res.json()) as { messages?: MessageDTO[] };
        if (!stillCurrent()) return;
        const next = Array.isArray(body.messages) ? body.messages : [];
        loadedForRef.current = requestKey;
        setViewRevision(requestKey);
        setMessages(next);
        const theirs = next.find((m) => m.senderHandle !== h);
        setOtherHandle(theirs?.senderHandle ?? "");
        setState("ready");
      } catch (err) {
        // An abort is our own teardown, never a failure the reader should see.
        const aborted =
          signal?.aborted || (err instanceof Error && err.name === "AbortError");
        if (!aborted && stillCurrent()) {
          setViewRevision(requestKey);
          if (!sameThreadReadKey(loadedForRef.current, conversationId, requestRevision)) {
            setState("unreachable");
          }
        }
      }
    },
    [accountRevision, conversationId, user, authHandle, viewerSession.unresolved],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Realtime signal-only nudge with a mandatory 10s polling fallback. The nudge
    // never carries content — it just triggers the same gated refetch.
    const unsub = subscribeToMessages(conversationId, () => void refresh(), {
      poll: () => void refresh(),
    });
    // A belt-and-braces interval in case realtime AND its internal fallback are
    // both unavailable early (the page must stay live regardless).
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      unsub();
    };
  }, [conversationId, refresh, handle]);

  // Auto-scroll to the newest message on change.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // The field grows with what is typed and stops at the CSS max-height, where
  // it starts scrolling. Measured off scrollHeight each change, because a row
  // count cannot know how a line wrapped.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft]);

  // A preview object URL belongs to the pending photo, so it is released when
  // that photo is replaced, sent or taken off.
  useEffect(() => {
    if (pending?.kind !== "photo") return;
    const url = pending.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const over = draft.length > MAX_MESSAGE_BODY;
  // A photo is a message. Something to send is text, an attachment, or both.
  const hasSomething = draft.trim().length > 0 || pending !== null;
  const canSend = hasSomething && !over && !sending;

  const clearPending = useCallback(() => {
    setPending(null);
    setCropping(null);
    setPickingVenue(false);
  }, []);

  const handlePhotoFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError("");
    setCropping(file);
  }, []);

  const handleAttachKindSelected = useCallback((kind: MessageAttachKind) => {
    trackEvent("message_attach_selected", { kind });
  }, []);

  const send = useCallback(async () => {
    const h = normalizeHandle(authHandle ?? "") || readHandle();
    const bodyText = draft.trim();
    if (!user || !h || over) return;
    if (!bodyText && !pending) return;
    setSending(true);
    setError("");
    try {
      const address = `/api/messages/${encodeURIComponent(conversationId)}`;
      const post = {
        action: "send",
        handle: h,
        body: bodyText,
        ...(pending?.kind === "venue" ? { venueId: pending.venue.id } : {}),
      };

      let res: Response;
      if (pending?.kind === "photo") {
        // The photo lane is multipart: one JSON part and one file, exactly the
        // shape the pub wall already sends.
        const form = new FormData();
        form.append("post", JSON.stringify(post));
        form.append("photo", pending.file);
        res = await authedActionFetch(address, { method: "POST", body: form });
      } else {
        res = await authedActionFetch(address, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(post),
        });
      }

      if (res.status === 401) {
        discardBody(res);
        setState("signedout");
        return;
      }
      if (res.status === 429) {
        discardBody(res);
        setError("Too many messages, slow down.");
        return;
      }
      if (!res.ok) {
        // The server's own sentence when it has one: a refused photo and a
        // conversation that is gone are different things to be told.
        const body: unknown = await res.json().catch(() => null);
        setError(
          offlineOrMessage(errorMessageFrom(
                body,
                pending ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again.")
              ),
        );
        return;
      }
      discardBody(res);
      setDraft("");
      clearPending();
      await refresh();
    } catch {
      setError(
        offlineOrMessage(pending
            ? MESSAGE_PHOTO_FAILED_LINE
            : "Could not send that message. Try again.")
      );
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, over, pending, refresh, user, authHandle, clearPending]);

  const report = useCallback(
    async (messageId: string) => {
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!user || !h) return;
      setError("");
      try {
        const res = await authedActionFetch(`/api/messages/${encodeURIComponent(conversationId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "report", handle: h, messageId }),
        });
        if (!res.ok) {
          const body: unknown = await res.json().catch(() => null);
          setError(
            offlineOrMessage(errorMessageFrom(body, "Could not report that message. Try again."))
          );
          return;
        }
        discardBody(res);
        await refresh();
      } catch {
        setError(
          offlineOrMessage("Could not report that message. Try again.")
        );
      }
    },
    [conversationId, refresh, user, authHandle],
  );

  if (!sameThreadReadKey(viewRevision, conversationId, accountRevision)) {
    return <p className="conversationPreview">With you in a sec.</p>;
  }

  if (state === "signedout" && viewerSession.signedOut) {
    return (
      <div className="conversationPreview messagesSignInPrompt">
        <p>Sign in to read and send messages.</p>
        <SignInButton />
      </div>
    );
  }
  if (state === "signedout") {
    return <p className="conversationPreview">With you in a sec.</p>;
  }
  if (state === "notfound") {
    return (
      <p className="conversationPreview">
        Conversation not found. <Link href="/messages">Back to inbox</Link>
      </p>
    );
  }
  if (state === "unreachable") {
    return (
      <div className="threadFailure" role="status">
        <p>This conversation won&rsquo;t open right now. Your messages are safe.</p>
        <button
          type="button"
          className="threadRetryBtn"
          onClick={() => {
            setState("loading");
            void refresh();
          }}
        >
          Try again
        </button>
        <Link href="/messages">Back to inbox</Link>
      </div>
    );
  }

  return (
    <div className="messageThread">
      <div className="threadHeader">
        <Link href="/messages" className="threadBackLink">
          ← Inbox
        </Link>
        <span className="threadWith">
          {otherHandle ? `@${otherHandle}` : "Conversation"}
        </span>
      </div>

      {state === "loading" ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : (
        <ul className="threadMessages">
          {messages.map((m) => {
            const mine = m.senderHandle === handle;
            return (
              <li key={m.id} className={mine ? "messageRow messageRowMine" : "messageRow"}>
                {/* The box the 75% width limit lives on. */}
                <div className="messageLine">
                  <div
                    className={
                      mine
                        ? "messageBubble messageBubbleMine"
                        : "messageBubble messageBubbleTheirs"
                    }
                  >
                    {m.attachment?.kind === "photo" ? (
                      <MessagePhoto
                        url={m.attachment.url}
                        width={m.attachment.width}
                        height={m.attachment.height}
                        senderHandle={m.senderHandle}
                        handle={handle}
                      />
                    ) : null}
                    {m.attachment?.kind === "venue" ? (
                      <MessageVenueCard card={m.attachment.card} />
                    ) : null}
                    {m.body ? <MessageBody body={m.body} /> : null}
                  </div>
                  <div className="messageMeta">
                    {m.flagged ? (
                      <span className="messageFlagged">Reported</span>
                    ) : !mine ? (
                      <button
                        type="button"
                        className="messageReportBtn"
                        onClick={() => void report(m.id)}
                      >
                        Report
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
          <li className="threadListEnd" aria-hidden="true">
            <div ref={listEndRef} />
          </li>
        </ul>
      )}

      {error ? <p className="threadError">{error}</p> : null}

      <MessageAttachmentPicker
        ref={attachmentPickerRef}
        open={mobileAttachOpen && isMobileViewport}
        disabled={sending}
        onOpenChange={setMobileAttachOpen}
        onFileChange={handlePhotoFileChange}
        onKindSelected={handleAttachKindSelected}
      />

      {cropping ? (
        <div className="messageCropOverlay">
          <div
            ref={cropCardRef}
            className="messageCropCard"
            role="dialog"
            aria-modal="true"
            aria-label="Crop photo"
            tabIndex={-1}
          >
            <ProfileImageCropper
              key={fileKey(cropping)}
              target={MESSAGE_PHOTO_CROP_TARGET}
              file={cropping}
              busy={sending}
              onCancel={() => setCropping(null)}
              onCropped={(file) => {
                setCropping(null);
                setPending({ kind: "photo", file, previewUrl: URL.createObjectURL(file) });
              }}
            />
          </div>
        </div>
      ) : null}

      {pickingVenue ? (
        <MessageVenuePicker
          onCancel={() => setPickingVenue(false)}
          onPick={(venue) => {
            setPickingVenue(false);
            setPending({ kind: "venue", venue });
          }}
        />
      ) : null}

      {pending ? (
        <div className="composerPending">
          {pending.kind === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL for the photo about to send
            <img className="composerPendingThumb" src={pending.previewUrl} alt="" />
          ) : null}
          <span className="composerPendingLabel">
            {pending.kind === "photo" ? "Photo ready to send" : pending.venue.name}
          </span>
          <button type="button" className="composerPendingRemove" onClick={clearPending}>
            Remove
          </button>
        </div>
      ) : null}

      <div className="composer">
        <textarea
          ref={inputRef}
          className="composerInput"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          maxLength={MAX_MESSAGE_BODY + 100}
          rows={1}
          aria-label="Message"
          /* A message is somebody talking. The keyboard helps them the way it
             helps them everywhere else: sentence case, autocorrect on, spelling
             checked. Turning these off is what makes a web composer feel unlike
             the messaging app beside it. */
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          enterKeyHint={enterSends ? "send" : "enter"}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            // On a phone the return key writes a new line; only a keyboard with
            // a modifier to spare sends on it.
            if (!enterSends) return;
            e.preventDefault();
            if (canSend) void send();
          }}
        />
        <div className="composerControls">
          {isMobileViewport ? (
            <button
              type="button"
              className="composerMobileAttach"
              aria-label="Add an attachment"
              aria-expanded={mobileAttachOpen}
              disabled={sending}
              onClick={() => {
                setPickingVenue(false);
                setMobileAttachOpen(true);
              }}
            >
              Attach
            </button>
          ) : null}
          <button
            type="button"
            className="composerAttach composerPhotoDesktop"
            aria-label={MESSAGE_ATTACH_PHOTO_LABEL}
            aria-pressed={pending?.kind === "photo"}
            disabled={sending}
            onClick={() => {
              setPickingVenue(false);
              attachmentPickerRef.current?.select("photos");
            }}
          >
            {MESSAGE_ATTACH_PHOTO_SHORT}
          </button>
          <button
            type="button"
            className="composerAttach"
            aria-label={MESSAGE_ATTACH_VENUE_LABEL}
            aria-pressed={pending?.kind === "venue"}
            disabled={sending}
            onClick={() => {
              setCropping(null);
              setPickingVenue((open) => !open);
            }}
          >
            {MESSAGE_ATTACH_VENUE_SHORT}
          </button>
          <span className={over ? "composerCount composerCountOver" : "composerCount"}>
            {draft.length}/{MAX_MESSAGE_BODY}
          </span>
          <button
            type="button"
            className="composerSend"
            disabled={!canSend}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
