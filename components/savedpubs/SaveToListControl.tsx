"use client";

import { useCallback, useEffect, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { toggleSaveDurable } from "@/lib/savedPubs";
import {
  eligibleBuiltInListTypes,
  isListTypeEligibleForVenue,
} from "@/lib/savedListPolicy";
import type { VenueKind } from "@/lib/venues";

import "./saveToList.css";
import { authedActionFetch } from "@/lib/authedFetch";

// Save-a-venue-to-a-list control with CUSTOM LIST support (story 33). A small,
// self-contained island: it shows the eligible built-in lists PLUS the viewer's
// own custom lists, lets them file a venue under any of them, and lets them
// create a new named list inline.
// Identity is the self-asserted `pubmax_handle` (no auth yet); a signed-out viewer
// still gets the built-in localStorage save via toggleSaveDurable's fallback, but
// custom lists need a handle to persist server-side.

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export default function SaveToListControl({
  venueId,
  venueName,
  venueKind,
}: {
  venueId: string;
  venueName?: string;
  venueKind?: VenueKind;
}): React.JSX.Element {
  const [handle] = useState(readHandle);
  const [open, setOpen] = useState(false);
  const [customLists, setCustomLists] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Load the handle's custom lists lazily when the picker opens (cheap GET,
  // fail-soft to just the built-ins).
  const loadLists = useCallback(async () => {
    const h = handle.trim();
    if (!h) return;
    try {
      const res = await fetch(`/api/saved-pubs?handle=${encodeURIComponent(h)}&lists=1`);
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { lists?: string[] };
      setCustomLists(Array.isArray(body.lists) ? body.lists : []);
    } catch {
      // Offline / error — the built-ins are always available regardless.
    }
  }, [handle]);

  useEffect(() => {
    // Defer through a promise callback so setState never runs synchronously in
    // the effect body (react-hooks/set-state-in-effect).
    if (open) void Promise.resolve().then(() => loadLists());
  }, [open, loadLists]);

  const save = useCallback(
    async (listType: string) => {
      setBusy(true);
      try {
        await toggleSaveDurable(handle, venueId, listType, undefined, venueKind);
        setToast(`Saved to “${listType}”`);
        window.setTimeout(() => setToast(null), 2000);
      } finally {
        setBusy(false);
      }
    },
    [handle, venueId, venueKind],
  );

  const createAndSave = useCallback(async () => {
    const name = newName.trim();
    if (!name || busy) return;
    if (!isListTypeEligibleForVenue(name, venueKind)) {
      setToast("Pint lists are for pubs");
      window.setTimeout(() => setToast(null), 2000);
      return;
    }
    setBusy(true);
    try {
      const h = handle.trim();
      // Register the custom list (best-effort) then file the venue under it.
      if (h) {
        try {
          const res = await authedActionFetch("/api/saved-pubs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle: h, action: "createList", name }),
          });
          if (res.ok) {
            const body = (await res.json()) as { lists?: string[] };
            if (Array.isArray(body.lists)) setCustomLists(body.lists);
          }
        } catch {
          /* the save below still works even if the registry write failed */
        }
      }
      await toggleSaveDurable(handle, venueId, name, undefined, venueKind);
      setNewName("");
      setToast(`Saved to “${name}”`);
      window.setTimeout(() => setToast(null), 2000);
    } finally {
      setBusy(false);
    }
  }, [handle, venueId, venueKind, newName, busy]);

  if (!open) {
    return (
      <button type="button" className="saveToListToggle" onClick={() => setOpen(true)}>
        Save{venueName ? ` ${venueName}` : ""} to a list
      </button>
    );
  }

  const allLists = [...eligibleBuiltInListTypes(venueKind), ...customLists];

  return (
    <section className="saveToList" aria-label="Save this venue to a list">
      <div className="saveToListChips">
        {allLists.map((name) => (
          <button
            key={name}
            type="button"
            className="saveToListChip"
            onClick={() => void save(name)}
            disabled={busy}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="saveToListNew">
        <input
          type="text"
          value={newName}
          maxLength={60}
          placeholder="New list name"
          aria-label="New list name"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="saveToListCreate"
          onClick={() => void createAndSave()}
          disabled={busy || !newName.trim()}
        >
          Create &amp; save
        </button>
      </div>

      {toast ? (
        <p className="saveToListToast" role="status">
          {toast}
        </p>
      ) : null}

      <button type="button" className="saveToListClose" onClick={() => setOpen(false)}>
        Close
      </button>
    </section>
  );
}
