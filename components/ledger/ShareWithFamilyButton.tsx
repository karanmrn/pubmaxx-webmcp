"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useCallback, useState } from "react";

import { buildFamilyShareText } from "@/lib/ledger";

import "./shareWithFamilyButton.css";

// One-tap "Share with family" (issue #27, PRD § "The Spill" — The Family
// Table). Smallest honest implementation: feature-detect the Web Share API
// and use it when available (title/text/url share sheet — the native "send
// to Mail/Messages/WhatsApp" picker on phones, which is where most families
// actually forward this kind of thing from). Falls back to a plain `mailto:`
// link with the subject/body prefilled everywhere else (desktop browsers
// without navigator.share).
//
// PONYTAIL CEILING: this is deliberately NOT an email system. There's no send
// pipeline, no recipient list, no delivery tracking, no digest — just handing
// the OS/browser a pre-filled message and letting the family member's own
// mail/share app take it from there. A real "email this to the family every
// Sunday" digest is a genuinely different, backend-shaped project (a mail
// sender, an audience list, unsubscribe handling) — out of scope here and
// worth its own issue if the demand shows up.
//
// Usable for a single entry (pass `note`) or for the whole section (omit it —
// falls back to a section-level share).

type ShareWithFamilyButtonProps = {
  venueName: string;
  note?: string;
  url: string;
  /** Label override — entries use "Share with family", the section header
   *  can ask for something slightly different if it ever wants to. */
  label?: string;
  className?: string;
};

export default function ShareWithFamilyButton({
  venueName,
  note = "",
  url,
  label = "Share with family",
  className,
}: ShareWithFamilyButtonProps) {
  const [status, setStatus] = useState<"idle" | "shared" | "error">("idle");

  const shareText = buildFamilyShareText({ venueName, note, url });

  const handleClick = useCallback(async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: shareText.title,
          text: shareText.text,
          url: shareText.url,
        });
        setStatus("shared");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setStatus("error");
      }
      return;
    }
    // No Web Share API: navigate to the mailto: fallback directly.
    if (typeof window !== "undefined") {
      window.location.href = shareText.mailtoHref;
    }
  }, [shareText]);

  return (
    <>
      <button
        type="button"
        className={className ? `familyShareButton ${className}` : "familyShareButton"}
        onClick={handleClick}
        aria-label={`${label}${note ? ": " + venueName : ""}`}
      >
        {status === "shared" ? "Shared" : label}
      </button>
      {status === "error" ? (
        <span role="status">
          {offlineOrMessage("Could not share this. Try again.")}
        </span>
      ) : null}
    </>
  );
}
