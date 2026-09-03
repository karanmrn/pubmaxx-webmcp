"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Check, Link2, Route } from "lucide-react";
import { useState } from "react";

import { styleLabels, type CrawlMode } from "@/components/map/ControlRail";
import type { Filters } from "@/lib/venues";
import {
  ALT_CRAWL_STYLES,
  altStyleLabels,
  type AltCrawlStyle,
} from "@/lib/crawlUrl";

type RouteHeaderProps = {
  mode: CrawlMode;
  crawlStyle: Filters["crawlStyle"];
  crawlName?: string;
  crawlBlurb?: string;
  altStyle: AltCrawlStyle;
  onAltStyleChange: (style: AltCrawlStyle) => void;
};

export default function RouteHeader({
  mode,
  crawlStyle,
  crawlName,
  crawlBlurb,
  altStyle,
  onAltStyleChange,
}: RouteHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copyLink() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <>
      <div className="routeHeader">
        <div>
          <p className="eyebrow">{mode === "build" ? "Your Plan" : "Suggested Plan"}</p>
          <h2>
            {mode === "build"
              ? crawlName || "Hand-built plan"
              : `${styleLabels[crawlStyle]} plan`}
          </h2>
          {crawlBlurb ? (
            <p className="description muted" style={{ margin: "4px 0 0" }}>
              {crawlBlurb}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shareBtn"
          onClick={copyLink}
          aria-label="Copy a shareable link to this crawl"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {copyError ? <p role="status">{copyError}</p> : null}
        <Route size={24} />
      </div>

      <div
        className="altStylePicker"
        role="radiogroup"
        aria-label="Crawl style"
        data-testid="alt-style-picker"
      >
        {ALT_CRAWL_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={altStyle === style}
            className={altStyle === style ? "altStyleBtn active" : "altStyleBtn"}
            onClick={() => onAltStyleChange(style)}
          >
            {altStyleLabels[style]}
          </button>
        ))}
      </div>
    </>
  );
}
