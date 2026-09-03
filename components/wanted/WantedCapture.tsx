"use client";

import { useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type {
  WantedDTO,
  WantedResolveCandidate,
  WantedResolveResult,
} from "@/lib/wanted";

import "./wanted.css";

type Props = {
  onSaved?: (wanted: WantedDTO) => void;
  /** Prefill when saving from a venue sheet. */
  prefill?: {
    venueId: string;
    venueName: string;
    venueKind: "curated" | "uk_base";
  };
};

export default function WantedCapture({ onSaved, prefill }: Props): React.JSX.Element {
  const [paste, setPaste] = useState(prefill?.venueName ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [resolve, setResolve] = useState<WantedResolveResult | null>(null);

  async function saveConfirmed(candidate: WantedResolveCandidate, sourceUrl: string, rawPaste: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId: candidate.venueId,
          venueName: candidate.venueName,
          venueKind: candidate.venueKind,
          sourceUrl: sourceUrl || undefined,
          note: note || undefined,
          rawPaste: rawPaste || paste,
        }),
      });
      const body = (await res.json().catch(() => null)) as { wanted?: WantedDTO; error?: unknown; status?: string } | null;
      if (!body) {
        setStatus("Could not save that Wanted place.");
        return;
      }
      if (!res.ok || !body.wanted) {
        if (body.status === "sign_in_required") {
          setStatus("Sign in to save a Wanted place.");
        } else if (body.status === "onboarding_required") {
          setStatus("Choose a public handle before saving Wanted places.");
        } else {
          setStatus(errorMessageFrom(body, "Could not save that Wanted place."));
        }
        return;
      }
      trackEvent("wanted_created", {
        venueKind: body.wanted.venueKind,
        hasSourceUrl: Boolean(body.wanted.sourceUrl),
      });
      setStatus(`Saved ${body.wanted.venueName} for a night.`);
      setPaste("");
      setNote("");
      setResolve(null);
      onSaved?.(body.wanted);
    } catch {
      setStatus("Could not save that Wanted place.");
    } finally {
      setBusy(false);
    }
  }

  async function savePending(rawPaste: string, sourceUrl: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pending",
          rawPaste,
          sourceUrl: sourceUrl || undefined,
          note: note || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { wanted?: WantedDTO; error?: unknown; status?: string } | null;
      if (!body) {
        setStatus("Could not save that paste.");
        return;
      }
      if (!res.ok || !body.wanted) {
        if (body.status === "sign_in_required") {
          setStatus("Sign in to save a Wanted place.");
        } else {
          setStatus(errorMessageFrom(body, "Could not save that paste."));
        }
        return;
      }
      trackEvent("wanted_created", {
        venueKind: "pending",
        hasSourceUrl: Boolean(body.wanted.sourceUrl),
      });
      setStatus("Saved as still matching. Add a pub name when you know it.");
      setPaste("");
      setNote("");
      setResolve(null);
      onSaved?.(body.wanted);
    } catch {
      setStatus("Could not save that paste.");
    } finally {
      setBusy(false);
    }
  }

  async function onResolve() {
    const trimmed = paste.trim();
    if (!trimmed) return;

    if (prefill && trimmed === prefill.venueName) {
      await saveConfirmed(
        {
          venueId: prefill.venueId,
          venueName: prefill.venueName,
          venueKind: prefill.venueKind,
          address: "",
          contextLabel: "",
        },
        "",
        trimmed,
      );
      return;
    }

    setBusy(true);
    setStatus(null);
    setResolve(null);
    try {
      const res = await authedActionFetch("/api/wanted/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paste: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        status?: string;
        candidates?: WantedResolveCandidate[];
        sourceUrl?: string;
        query?: string;
        rawPaste?: string;
        sourcePlatform?: WantedResolveResult["sourcePlatform"];
      } | null;
      if (!body) {
        setStatus("Could not resolve that paste.");
        return;
      }
      if (!res.ok) {
        if (body.status === "sign_in_required") {
          setStatus("Sign in to save a Wanted place.");
        } else {
          setStatus(errorMessageFrom(body, "Could not resolve that paste."));
        }
        return;
      }
      if (!Array.isArray(body.candidates)) {
        setStatus("Could not resolve that paste.");
        return;
      }
      const resolved: WantedResolveResult = {
        query: body.query ?? "",
        sourceUrl: body.sourceUrl ?? "",
        sourcePlatform: body.sourcePlatform ?? "none",
        rawPaste: body.rawPaste ?? trimmed,
        status: body.status === "degraded" ? "degraded" : "ready",
        candidates: body.candidates,
      };
      if (resolved.candidates.length === 0) {
        setResolve(resolved);
        setStatus(
          resolved.sourceUrl && !resolved.query
            ? "We keep the link as provenance and never fetch Instagram or TikTok. Add a pub name, or save it as still matching."
            : "No match yet. Save as still matching, or try another name.",
        );
        return;
      }
      setResolve(resolved);
      setStatus("Confirm the pub below.");
    } catch {
      setStatus("Could not resolve that paste.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wantedCapture">
      <label className="wantedCapture__label" htmlFor="wanted-paste">
        Pub name or link
      </label>
      <div className="wantedCapture__row">
        <input
          id="wanted-paste"
          className="wantedCapture__input"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder="Pub name, or a link you saved"
          maxLength={500}
          disabled={busy}
        />
        <button
          type="button"
          className="wantedCapture__submit"
          onClick={() => void onResolve()}
          disabled={busy || !paste.trim()}
        >
          {busy ? "Working…" : "Find"}
        </button>
      </div>
      <label className="wantedCapture__label" htmlFor="wanted-note">
        Optional note
      </label>
      <input
        id="wanted-note"
        className="wantedCapture__note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional note"
        maxLength={140}
        disabled={busy}
      />
      {status ? (
        <p className="wantedCapture__status" role="status">
          {status}
        </p>
      ) : null}
      {resolve && resolve.candidates.length > 0 ? (
        <ul className="wantedCandidates" aria-label="Matching pubs">
          {resolve.candidates.map((candidate) => (
            <li key={candidate.venueId}>
              <button
                type="button"
                className="wantedCandidate"
                disabled={busy}
                onClick={() =>
                  void saveConfirmed(candidate, resolve.sourceUrl, resolve.rawPaste)
                }
              >
                <span className="wantedCandidate__name">{candidate.venueName}</span>
                <span className="wantedCandidate__meta">
                  {candidate.venueKind === "uk_base" ? "UK pub" : "On the map"}
                  {candidate.contextLabel ? ` · ${candidate.contextLabel}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {resolve && resolve.candidates.length === 0 ? (
        <button
          type="button"
          className="wantedCapture__secondary"
          disabled={busy}
          onClick={() => void savePending(resolve.rawPaste || paste, resolve.sourceUrl)}
        >
          Save as still matching
        </button>
      ) : null}
    </div>
  );
}
