"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import type { WantedDTO } from "@/lib/wanted";
import { discardBody } from "@/lib/responseBody";

import "./wanted.css";

/** Open Wanteds as plan describe-first chips so saved places become tonight options. */
export default function WantedPlanChips({
  onPick,
}: {
  onPick: (query: string) => void;
}): React.JSX.Element | null {
  const { identityResolved, user } = useAuth();
  const userId = identityResolved ? user?.id ?? null : null;
  const [result, setResult] = useState<{
    ownerId: string;
    open: WantedDTO[];
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedFetch("/api/wanted?open=1");
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { wanteds?: WantedDTO[] };
        if (cancelled) return;
        setResult({
          ownerId: userId,
          open: (body.wanteds ?? []).filter(
            (row) => row.status === "open" && row.venueKind !== "pending" && row.venueName,
          ),
        });
      } catch {
        // Signed-out / offline: hide the Wanted chip lane.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const open = result?.ownerId === userId ? result.open : [];

  if (open.length === 0) return null;

  return (
    <div className="wantedPlanChips" role="group" aria-label="Your Wanted list">
      <p className="wantedPlanChips__label">Your Wanted list</p>
      {open.slice(0, 6).map((wanted) => {
        const chip = `a night at ${wanted.venueName}`;
        return (
          <button
            key={wanted.id}
            type="button"
            className="wantedPlanChip"
            onClick={() => onPick(chip)}
          >
            {wanted.venueName}
          </button>
        );
      })}
    </div>
  );
}
