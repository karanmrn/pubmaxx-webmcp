"use client";

// "Live tonight" presence strip (PRD §1.5 / §5.1 — the tonight loop). A compact,
// horizontal band at the top of the feed showing who tapped "I'm here" recently:
// "@handle at The Lamb · 12m ago", each pub linking to /map?sel=<venueId>.
//
// Fail-quiet by design: an empty or failed fetch renders NOTHING (never a broken
// band). React 19 rules — fetch fires in an effect, setState only inside the
// async resolution/catch (never the effect body), AbortController cancels on
// unmount.

import Link from "next/link";
import { useEffect, useState } from "react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import { displayHandle } from "@/lib/handleDisplay";
import { relativeTime } from "@/lib/relativeTime";

type PresenceDTO = {
  handle: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  at: string;
  avatarUrl?: string;
  // Set ONLY on seeded ambient demo rows (lib/ambientPresence) — real taps never
  // carry it. Rendered as the shared honest "Demo" chip, matching feed/drinks.
  provenance?: "demo";
};

// `spillingNow` (issue #37): a derived count of drops logged in the last hour,
// passed in by the host (the feed already read the filtered pint-drops list, so
// this respects #29 visibility — a withheld drop was never counted). Optional so
// the strip works anywhere; a 0/absent count simply hides the "spilling now"
// chip. The strip still renders if there's presence OR a live count.
export default function PresenceStrip({ spillingNow = 0 }: { spillingNow?: number }) {
  const [presence, setPresence] = useState<PresenceDTO[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/presence", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { presence?: PresenceDTO[] }) => {
        setPresence(Array.isArray(data.presence) ? data.presence : []);
      })
      .catch((err: unknown) => {
        // Abort is expected on unmount — not an error surface. Any other failure
        // leaves presence empty, so the strip simply doesn't render.
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setPresence([]);
      });
    return () => controller.abort();
  }, []);

  // Empty presence AND no live count → render nothing. Never a broken/empty band.
  if (presence.length === 0 && spillingNow <= 0) return null;

  return (
    <section className="presenceStrip" aria-label="People out tonight">
      <span className="presenceStripLabel">
        <span className="presenceDot" aria-hidden="true" />
        Live tonight
      </span>
      {spillingNow > 0 ? (
        <span className="presenceSpilling" aria-label={`${spillingNow} spilling right now`}>
          {spillingNow} spilling right now
        </span>
      ) : null}
      {presence.length > 0 ? (
      <ul className="presenceList">
        {presence.map((p) => {
          const ago = relativeTime(p.at);
          return (
            <li key={`${p.handle}-${p.venueId}`} className="presenceItem">
              <HandleAvatar
                handle={p.handle}
                avatarUrl={p.avatarUrl}
                className="presenceAvatar"
                imageClassName="presenceAvatar"
                size={24}
              />
              <span className="presenceHandle">{displayHandle(p.handle)}</span>
              <span className="presenceAt">at</span>
              <Link href={p.venueMapUrl} className="presenceVenue">
                {p.venueName}
              </Link>
              {ago ? <span className="presenceAgo">· {ago}</span> : null}
              {p.provenance === "demo" ? (
                <span className="presenceDemoChip" title="Seeded example presence">
                  Demo
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      ) : null}
    </section>
  );
}
