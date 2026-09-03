"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";

// Owner-only edit/delete controls for a durable Crawl Story (story 35). The story
// page is a server component and never knows who is viewing; this client island
// reads the viewer's self-asserted handle from localStorage (the same
// `pubmax_handle` the rest of the app writes) and only renders when it matches the
// story's author handle. The server route re-checks authorship (isAuthor) on every
// PATCH/DELETE — this is a UX affordance, not the security boundary.
//
// AUTHORSHIP note: matching on a self-asserted handle is a WEAK client gate (see
// app/api/crawls/[slug]/route.ts). It hides the controls from non-owners; the API
// is what actually enforces ownership until auth ownership merges.

const HANDLE_KEY = "pubmax_handle";

function readViewerHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim().toLowerCase();
}

export default function CrawlStoryOwnerControls({
  slug,
  authorHandle,
}: {
  slug: string;
  authorHandle: string;
}) {
  const router = useRouter();
  // Lazy initialiser reads localStorage on first client render — no effect.
  const [viewer] = useState(readViewerHandle);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Only the author sees the controls. A handle mismatch (or a signed-out viewer)
  // renders nothing.
  if (!viewer || viewer !== authorHandle.trim().toLowerCase()) return null;

  async function handleDelete() {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this crawl permanently?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await authedActionFetch(`/api/crawls/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: viewer }),
      });
      if (!res.ok) {
        discardBody(res);
        setMessage(res.status === 403 ? "You can only delete a crawl you authored." : "Could not delete this crawl.");
        return;
      }
      // Gone — send the (former) author back to the crawls index.
      router.push("/crawls");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="storyOwnerControls" role="group" aria-label="Author controls">
      <button
        type="button"
        className="storySecondaryBtn"
        onClick={handleDelete}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Deleting…" : "Delete crawl"}
      </button>
      {message ? (
        <p role="alert" style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--brass)" }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
