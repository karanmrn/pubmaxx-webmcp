"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useCallback, useRef, useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { whatsappShareHref } from "@/lib/shareArtifacts";

import "./share.css";

// A reusable share row — a little pressed-brass stamp strip that sits under a
// pint memory card or a crawl poster (cc_plan2 §11). Every pint and crawl gets
// to spread across X, WhatsApp, and any group chat, so the story travels.
//
// Design: quiet until hovered, small 44px brass icon buttons, part of the
// pub-ephemera artifact rather than a generic social widget. Reduced-motion is
// respected in CSS; every control has a visible focus ring and an aria-label.
//
// React 19 hygiene (react-hooks/set-state-in-effect is an ERROR): the "Copied"
// confirmation is set in the click handler and reset from a setTimeout callback
// — never from an effect body. The pending timeout id lives in a ref so a fast
// second click can clear the previous timer without any effect.

type ShareBarProps = {
  // Relative ("/p/abc") or absolute; resolved against window.location.origin at
  // click time so it works from any deploy origin without a build-time base url.
  url: string;
  // The share title — used for the copy that leads a tweet / WhatsApp message.
  title: string;
  // Optional nostalgic one-liner; falls back to the title when omitted.
  text?: string;
  // Taste fix (feed card slim, 2026-07): the feed card's single action row
  // wants ONE quiet share icon, not a permanently-open strip of four buttons.
  // Compact mode swaps the "Share" caption for a single toggle stamp; every
  // existing channel (X, WhatsApp, copy, native) still lives one tap away —
  // nothing is removed, it just starts folded.
  compact?: boolean;
};

// Resolve a possibly-relative url to an absolute one, lazily, at click time.
// A url that is already absolute is returned untouched; anything else is
// resolved against the current origin. Guarded so a bad input never throws.
function toAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

export default function ShareBar({ url, title, text, compact = false }: ShareBarProps) {
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  // Compact mode starts folded — the toggle reveals the exact same channel
  // buttons below. Non-compact ("default") mode never folds, unchanged from
  // before this prop existed (every other ShareBar call site is unaffected).
  const [expanded, setExpanded] = useState(false);
  const showChannels = !compact || expanded;
  // Feature-detect native share once, lazily — never assumed. On the server and
  // on browsers without the Web Share API this stays false and the button is
  // simply not rendered.
  const [canNativeShare] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shareText = text?.trim() || title;
  const isPlanInvite = /^\/plan\/[^/?#]+/.test(url);

  const trackPlanInvite = useCallback((channel: string) => {
    if (isPlanInvite) trackEvent("plan_invite_sent", { channel });
  }, [isPlanInvite]);

  const flashCopied = useCallback(() => {
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setCopied(false);
      resetTimer.current = null;
    }, 2000);
  }, []);

  const handleCopy = useCallback(async () => {
    const absolute = toAbsoluteUrl(url);
    setShareError("");
    try {
      await navigator.clipboard.writeText(absolute);
      trackPlanInvite("copy");
      flashCopied();
    } catch {
      setShareError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }, [url, flashCopied, trackPlanInvite]);

  const handleNativeShare = useCallback(async () => {
    const absolute = toAbsoluteUrl(url);
    setShareError("");
    try {
      await navigator.share({ title, text: shareText, url: absolute });
      trackPlanInvite("native");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setShareError(
        offlineOrMessage("Could not share link. Try again.")
      );
    }
  }, [url, title, shareText, trackPlanInvite]);

  // Intent urls are built at click time so the absolute url is always current.
  const openIntent = useCallback(
    (build: (absoluteUrl: string) => string) => {
      const absolute = toAbsoluteUrl(url);
      setShareError("");
      try {
        const opened = window.open(build(absolute), "_blank", "noopener,noreferrer");
        if (opened) return true;
      } catch {
        // The browser can block an external handoff before it creates a window.
      }
      setShareError(
        offlineOrMessage("Could not open sharing app. Try again.")
      );
      return false;
    },
    [url],
  );

  const tweetHref = (absolute: string) =>
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(absolute)}`;

  const whatsappHref = (absolute: string) => whatsappShareHref(shareText, absolute);

  return (
    <div
      className={`shareBar${compact ? " shareBar--compact" : ""}`}
      role="group"
      aria-label="Share this"
    >
      {compact ? (
        <button
          type="button"
          className="shareBar__btn shareBar__toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide share options" : "Share this"}
          title={expanded ? "Hide share options" : "Share"}
          onClick={() => setExpanded((v) => !v)}
        >
          <ShareMark />
        </button>
      ) : (
        <span className="shareBar__label" aria-hidden="true">
          Share
        </span>
      )}

      {showChannels ? (
        <>
          {/* Native share — only when the Web Share API is actually supported. */}
          {canNativeShare ? (
            <button
              type="button"
              className="shareBar__btn"
              onClick={handleNativeShare}
              aria-label="Share to another app"
              title="Share to another app"
            >
              <ShareMark />
            </button>
          ) : null}

          {/* WhatsApp — same progressive-enhancement shape. */}
          <a
            className="shareBar__btn"
            href={whatsappHref(url)}
            onClick={(event) => {
              event.preventDefault();
              if (openIntent(whatsappHref)) trackPlanInvite("whatsapp");
            }}
            target="_blank"
            rel="noreferrer"
            aria-label="Share on WhatsApp"
            title="Share on WhatsApp"
          >
            <WhatsAppMark />
          </a>

          {/* X / Twitter — server-rendered as a real anchor so it works without JS;
              onClick upgrades it to build the absolute url at click time. */}
          <a
            className="shareBar__btn"
            href={tweetHref(url)}
            onClick={(event) => {
              event.preventDefault();
              if (openIntent(tweetHref)) trackPlanInvite("x");
            }}
            target="_blank"
            rel="noreferrer"
            aria-label="Share on X"
            title="Share on X"
          >
            <XMark />
          </a>

          {/* Copy link — confirms with "Copied" for a beat, then quietly resets. */}
          <button
            type="button"
            className="shareBar__btn"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : "Copy link"}
            title={copied ? "Copied" : "Copy link"}
          >
            {copied ? <CheckMark /> : <LinkMark />}
          </button>
        </>
      ) : null}

      {/* Polite live confirmation for screen readers when a link is copied. */}
      <span className="shareBar__confirm" role="status" aria-live="polite">
        {copied ? "Copied" : shareError}
      </span>
    </div>
  );
}

// ── Brand & glyph marks (real SVG, currentColor so the brass hover carries) ───

function XMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}

function LinkMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ShareMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}
