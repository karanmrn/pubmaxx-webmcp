"use client";

import { useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { isUkBaseVenueId, type WantedDTO } from "@/lib/wanted";

import "./wanted.css";

export default function SaveForNightButton({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setToast(null);
    try {
      const res = await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          venueName,
          venueKind: isUkBaseVenueId(venueId) ? "uk_base" : "curated",
          rawPaste: venueName,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        wanted?: WantedDTO;
        error?: unknown;
        status?: string;
      };
      if (!res.ok || !body.wanted) {
        if (body.status === "sign_in_required") {
          setToast("Sign in to save for a night.");
        } else if (body.status === "onboarding_required") {
          setToast("Choose a public handle first.");
        } else {
          setToast(errorMessageFrom(body, "Could not save for a night."));
        }
        return;
      }
      trackEvent("wanted_created", {
        venueKind: body.wanted.venueKind,
        hasSourceUrl: false,
      });
      setToast("Saved for a night.");
      window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("Could not save for a night.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wantedSaveWrap">
      <button
        type="button"
        className="wantedSaveBtn"
        onClick={() => void save()}
        disabled={busy}
        aria-label={`Save ${venueName} for a night`}
      >
        {busy ? "Saving…" : "Save for a night"}
      </button>
      {toast ? (
        <p className="wantedCapture__status" role="status">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
