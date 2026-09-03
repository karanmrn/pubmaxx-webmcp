"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

export default function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const { handle: authHandle } = useAuth();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [handle, setHandle] = useState("");
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const fromAuth = normalizeHandle(authHandle ?? "");
      setHandle(fromAuth || readHandle());
    });
    return () => {
      active = false;
    };
  }, [authHandle, socialFriendsLaunchEnabled]);

  const refresh = useCallback(async () => {
    if (!socialFriendsLaunchEnabled) return;
    const h = normalizeHandle(authHandle ?? "") || handle.trim();
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { unread?: number };
      setUnread(typeof body.unread === "number" ? body.unread : 0);
    } catch {
      // Aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle, authHandle, socialFriendsLaunchEnabled]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    if (!handle.trim() && !authHandle) return;
    void Promise.resolve().then(() => refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh, authHandle, socialFriendsLaunchEnabled]);

  const label = !socialFriendsLaunchEnabled
    ? "Social preview"
    : unread > 0
      ? `Activity: ${unread} unread`
      : "Activity";

  return (
    <Link
      href="/activity"
      className="siteNavBell"
      aria-label={label}
      title={label}
      onPointerDown={() => {
        try {
          router.prefetch("/activity");
        } catch {
          // prefetch is best-effort
        }
      }}
    >
      <Bell size={18} aria-hidden="true" />
      {socialFriendsLaunchEnabled && unread > 0 ? (
        // key={unread} remounts the badge whenever the count changes, so the
        // CSS pop-in (siteNav.css .siteNavBellBadge) replays as a bump —
        // no separate "did it change" animation state to track.
        <span key={unread} className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
