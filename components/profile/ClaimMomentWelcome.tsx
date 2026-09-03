"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  IDENTITY_HANDLE_CHANGED_EVENT,
  identityHandleForOwner,
} from "@/lib/identityClient";

import "./claimMomentWelcome.css";

// Shows once, right after a visitor claims or renames their handle in THIS
// session — never a modal, just a warm line above the first-actions row.
//
// Detection: a direct window listener on IDENTITY_HANDLE_CHANGED_EVENT,
// matched against the signed-in owner id. AuthProvider's own `handle` field
// is NOT a safe signal here — it also updates on ordinary page-load identity
// resolution (ANY existing user's handle resolves null -> set as a normal
// side effect of that async lookup), so a naive null-to-set transition would
// fire the welcome for every returning owner, not just a genuine claim. The
// event only fires from the actual claim/rename flows (AccountOnboarding,
// PubmaxxAccountHub), so it is the one clean "just claimed" signal.
//
// Known gap, left as-is by design: a claim made from a DIFFERENT page (the
// global account nudge, say) won't retroactively show this after a later
// visit to the profile page, since that would mean touching AuthProvider or
// the claim flows themselves — out of scope here.

export default function ClaimMomentWelcome() {
  const { user } = useAuth();
  const [justClaimed, setJustClaimed] = useState(false);

  useEffect(() => {
    if (!user) return;
    const ownerId = user.id;
    function onChanged(event: Event) {
      const handle = identityHandleForOwner(
        (event as CustomEvent<unknown>).detail,
        ownerId,
      );
      if (handle) setJustClaimed(true);
    }
    window.addEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
  }, [user]);

  if (!justClaimed) return null;

  return (
    <p className="claimWelcome" role="status">
      Your @handle is yours. Everything below is now saved to it, starting with these:
    </p>
  );
}
