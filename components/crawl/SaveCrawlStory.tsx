"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { BookMarked, Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { encodeCrawlStory, VIBE_TAGS, type VibeTag } from "@/lib/crawlStory";
import { authedActionFetch } from "@/lib/authedFetch";

// A self-contained "Save as story" control. Decoupled from the Venue type on
// purpose: it accepts the minimal stop shape so it can be dropped anywhere a
// crawl exists. Opens a small inline panel (title / caption / vibe chips),
// encodes a /crawls?s=... link and copies it to the clipboard.

type SaveCrawlStoryStop = {
  venueId: string;
  name: string;
  priceGbp?: number | null;
};

type SaveCrawlStoryProps = {
  stops: SaveCrawlStoryStop[];
  defaultTitle?: string;
};

export default function SaveCrawlStory({ stops, defaultTitle }: SaveCrawlStoryProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<VibeTag[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  // The durable permalink: the /crawls/[slug] URL returned by POST /api/crawls,
  // or "" until one is saved. "saving" gates a double-submit; "error" surfaces a
  // friendly failure without blowing away the anonymous copy path.
  const [permaLink, setPermaLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function toggleTag(tag: VibeTag) {
    setCopied(false);
    setCopyError("");
    setSaveError("");
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  function buildLink(): string {
    const encoded = encodeCrawlStory({
      title: title.trim() || defaultTitle || "My London crawl",
      caption: caption.trim(),
      vibeTags: tags,
      stops: stops.map((stop) => ({
        venueId: stop.venueId,
        name: stop.name,
        priceGbp: stop.priceGbp ?? null,
      })),
      createdAt: new Date().toISOString().slice(0, 10),
    });
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/crawls?s=${encoded}`;
  }

  async function copyStoryLink() {
    const link = buildLink();
    setCopyError("");
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  // Persist the crawl to Supabase (via /api/crawls) so it earns a stable,
  // slug-addressed permalink (/crawls/[slug]) — the durable upgrade over the
  // anonymous ?s= link above. Best-effort: a failure surfaces a friendly message
  // and leaves the anonymous copy path fully working.
  async function savePermanentLink() {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setPermaLink("");
    try {
      // Attribute the saved crawl to the viewer's self-asserted device handle
      // (story 35), the same `pubmax_handle` the rest of the app writes. Absent
      // for a signed-out viewer → the crawl is saved anonymously.
      const authorHandle =
        typeof window !== "undefined"
          ? (window.localStorage.getItem("pubmax_handle") ?? "").trim()
          : "";
      const res = await authedActionFetch("/api/crawls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || defaultTitle || "My London crawl",
          summary: caption.trim(),
          visibility: "public",
          vibeTags: tags,
          ...(authorHandle ? { authorHandle } : {}),
          stops: stops.map((stop) => ({
            venueId: stop.venueId,
            priceGbp: stop.priceGbp ?? null,
          })),
        }),
      });
      if (!res.ok) {
        discardBody(res);
        setSaveError(
          res.status === 429
            ? "You're saving crawls too fast. Try again in a minute."
            : "Couldn't save a permanent link right now.",
        );
        return;
      }
      const body = (await res.json()) as { slug?: string };
      if (!body.slug) {
        setSaveError("Couldn't save a permanent link right now.");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const link = `${origin}/crawls/${body.slug}`;
      setPermaLink(link);
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        setCopyError(
          offlineOrMessage("Could not copy link. Try again.")
        );
      }
    } catch {
      setSaveError(offlineOrMessage("Couldn't save a permanent link right now."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="addStopBtn"
        style={{ marginTop: 0, marginBottom: "12px" }}
        onClick={() => setOpen(true)}
      >
        <BookMarked size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
        Save as story
      </button>
    );
  }

  return (
    <section
      aria-label="Save this crawl as a shareable story"
      style={{
        marginBottom: "12px",
        padding: "12px",
        border: "1px solid var(--line)",
        borderRadius: "10px",
        background: "var(--panel)",
        display: "grid",
        gap: "10px",
      }}
    >
      <label style={{ display: "grid", gap: "4px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Story title</span>
        <input
          type="text"
          value={title}
          maxLength={80}
          placeholder={defaultTitle || "Name this crawl"}
          onChange={(event) => {
            setCopied(false);
            setCopyError("");
            setPermaLink("");
            setSaveError("");
            setTitle(event.target.value);
          }}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--panel-raised)",
            color: "var(--ink)",
            fontSize: "14px",
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "4px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Caption</span>
        <textarea
          value={caption}
          maxLength={280}
          rows={2}
          placeholder="What made this crawl worth walking?"
          onChange={(event) => {
            setCopied(false);
            setCopyError("");
            setPermaLink("");
            setSaveError("");
            setCaption(event.target.value);
          }}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--panel-raised)",
            color: "var(--ink)",
            fontSize: "14px",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {VIBE_TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => toggleTag(tag)}
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                border: `1px solid ${active ? "var(--brass)" : "var(--line)"}`,
                background: active ? "var(--brass)" : "var(--panel-raised)",
                color: active ? "var(--panel-raised)" : "var(--ink-soft)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="addStopBtn" style={{ marginTop: 0 }} onClick={copyStoryLink}>
          {copied ? (
            <Check size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          ) : (
            <Copy size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          )}
          {copied ? "Copied" : "Copy share link"}
        </button>
        {/* The durable upgrade: POST to /api/crawls for a permanent /crawls/[slug]
            link. The anonymous copy button above still works either way. */}
        <button
          type="button"
          className="addStopBtn"
          style={{ marginTop: 0 }}
          onClick={savePermanentLink}
          disabled={saving}
          aria-busy={saving}
        >
          <Link2 size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          {saving ? "Saving…" : "Save a permanent link"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink-soft)",
            fontSize: "13px",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Close
        </button>
      </div>

      {saveError ? (
        <p role="alert" style={{ margin: 0, fontSize: "13px", color: "var(--brass)" }}>
          {saveError}
        </p>
      ) : null}

      {copyError ? (
        <p role="status" style={{ margin: 0, fontSize: "13px", color: "var(--brass)" }}>
          {copyError}
        </p>
      ) : null}

      {permaLink ? (
        <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-soft)" }}>
          Permanent link (copied):{" "}
          <a href={permaLink} style={{ color: "var(--brass)", wordBreak: "break-all" }}>
            {permaLink}
          </a>
        </p>
      ) : null}
    </section>
  );
}
