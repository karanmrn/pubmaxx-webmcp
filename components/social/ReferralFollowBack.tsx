"use client";

// WP7: after a referral signup claim, offer one honest Follow for the inviter.
// Session-scoped only. Dismiss or follow clears the prompt.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { displayHandle } from "@/lib/handleDisplay";
import {
  clearReferralFollowHandle,
  readReferralFollowHandle,
} from "@/lib/referralFollowBack";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import { useAuth } from "@/components/auth/AuthProvider";

import "./referralFollowBack.css";

export default function ReferralFollowBack({
  myHandle,
}: {
  myHandle?: string | null;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const { accountRevision } = useAuth();
  const [inviterHandle, setInviterHandle] = useState<string | null>(null);
  const previousRevision = useRef(accountRevision);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (previousRevision.current !== accountRevision) {
        previousRevision.current = accountRevision;
        clearReferralFollowHandle();
        setInviterHandle(null);
        return;
      }
      let viewer = normalizeHandle(myHandle ?? "");
      if (!viewer) {
        try {
          viewer = normalizeHandle(
            window.localStorage.getItem("pubmax_handle") ?? "",
          );
        } catch {
          viewer = "";
        }
      }
      const handle = readReferralFollowHandle();
      if (!handle || (viewer && handle === viewer)) {
        setInviterHandle(null);
        return;
      }
      setInviterHandle(handle);
    });
  }, [accountRevision, myHandle]);

  if (!socialFriendsLaunchEnabled || !inviterHandle) return null;

  return (
    <section className="referralFollowBack" aria-label="Follow your inviter">
      <p className="referralFollowBack__eyebrow">Your invite</p>
      <h2 className="referralFollowBack__title">
        Follow {displayHandle(inviterHandle)}?
      </h2>
      <p className="referralFollowBack__body">
        They invited you. Follow them, and once they follow back you share a
        lot.
      </p>
      <div className="referralFollowBack__actions">
        <Link
          className="referralFollowBack__primary"
          href={`/add/${encodeURIComponent(inviterHandle)}`}
          onClick={() => clearReferralFollowHandle()}
        >
          Follow {displayHandle(inviterHandle)}
        </Link>
        <button
          type="button"
          className="referralFollowBack__ghost"
          onClick={() => {
            clearReferralFollowHandle();
            setInviterHandle(null);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
