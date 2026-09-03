"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useState } from "react";

export default function CrawlStoryCopyButton() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyLink() {
    setError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <>
      <button type="button" className="storySecondaryBtn" onClick={copyLink}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {error ? <p role="status">{error}</p> : null}
    </>
  );
}
