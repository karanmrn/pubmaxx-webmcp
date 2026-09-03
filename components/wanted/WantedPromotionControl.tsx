"use client";

import { useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import { BUILT_IN_LIST_TYPES } from "@/lib/savedListPolicy";

export default function WantedPromotionControl({
  wantedId,
  promotedListType = null,
}: {
  wantedId: string;
  promotedListType?: string | null;
}): React.JSX.Element {
  const [listType, setListType] = useState<string>(BUILT_IN_LIST_TYPES[0]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (promotedListType) {
    return (
      <p className="wantedPromotionState" role="status">
        Added to {promotedListType}
      </p>
    );
  }

  async function promote(): Promise<void> {
    if (status === "saving" || status === "saved") return;
    setStatus("saving");
    setMessage(null);
    try {
      const response = await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "promote",
          id: wantedId,
          listType,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus("error");
        setMessage(errorMessageFrom(body, "Could not add this pub. Try again."));
        return;
      }
      setStatus("saved");
      setMessage(`Added to ${listType}.`);
      trackEvent("wanted_promoted");
    } catch {
      setStatus("error");
      setMessage(
        navigator.onLine === false
          ? "You look offline. Reconnect, then try again."
          : "Could not add this pub. Try again.",
      );
    }
  }

  return (
    <div className="wantedPromotion">
      <label>
        <span>Public list</span>
        <select
          value={listType}
          disabled={status === "saving" || status === "saved"}
          onChange={(event) => {
            setListType(event.target.value);
            setStatus("idle");
            setMessage(null);
          }}
        >
          {BUILT_IN_LIST_TYPES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={status === "saving" || status === "saved"}
        onClick={promote}
      >
        {status === "saving"
          ? "Adding…"
          : status === "saved"
            ? "Added"
            : "Add to public list"}
      </button>
      {message ? <span role="status">{message}</span> : null}
    </div>
  );
}
