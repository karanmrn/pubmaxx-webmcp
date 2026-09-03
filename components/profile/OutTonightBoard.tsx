"use client";

// Friends-only "who's out tonight" board on You. Reads GET /api/check-ins?viewer=
// which runs through lib/socialFeed.ts visibleCheckInsForViewer (mutuals + self).
// Renders only when the viewer has a claimed handle; empty when the lot is quiet.

import Link from "next/link";
import { useEffect, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import HandleAvatar from "@/components/profile/HandleAvatar";
import { tryGetNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import "./outTonightBeacon.css";

type Props = {
  /** Signed-in viewer handle. Empty when signed out — the board stays hidden. */
  viewerHandle: string;
};

type CheckInDto = {
  handle?: string;
  areaSlug?: string | null;
  note?: string | null;
  createdAt?: string;
  avatarUrl?: string;
};

type BoardRow = {
  handle: string;
  areaName: string | null;
  note: string | null;
  createdAt: string;
  ago: string;
  avatarUrl?: string;
};

type State =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; rows: BoardRow[] }
  | { kind: "error" };

function toBoardRows(checkIns: CheckInDto[]): BoardRow[] {
  return checkIns
    .map((row) => {
      const handle = normalizeHandle(row.handle ?? "");
      if (!handle) return null;
      const areaSlug = row.areaSlug as NightAreaSlug | null | undefined;
      const areaName = tryGetNightArea(areaSlug)?.name ?? null;
      const createdAt = typeof row.createdAt === "string" ? row.createdAt : "";
      return {
        handle,
        areaName,
        note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
        createdAt,
        ago: relativeTime(createdAt),
        ...(typeof row.avatarUrl === "string" ? { avatarUrl: row.avatarUrl } : {}),
      };
    })
    .filter((row): row is BoardRow => row !== null);
}

export default function OutTonightBoard({ viewerHandle }: Props) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const viewer = normalizeHandle(viewerHandle);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!socialFriendsLaunchEnabled || !viewer) return;

    const controller = new AbortController();
    let cancelled = false;
    // Deferred like useWhatsOnTonight's setState (react-hooks rule): the
    // loading state lands next microtask, never inside the effect body.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setState({ kind: "loading" });
      try {
        const res = await fetch(`/api/check-ins?viewer=${encodeURIComponent(viewer)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`check-ins ${res.status}`);
        }
        const body = (await res.json()) as { checkIns?: CheckInDto[] };
        const rows = toBoardRows(body.checkIns ?? []);
        setState(rows.length ? { kind: "ready", rows } : { kind: "empty" });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({ kind: "error" });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [socialFriendsLaunchEnabled, viewer]);

  if (!socialFriendsLaunchEnabled || !viewer || state.kind === "hidden") return null;

  if (state.kind === "loading") {
    return (
      <section className="beaconCard beaconBoard" aria-labelledby="beacon-board-title" aria-busy="true">
        <p className="beaconKicker" id="beacon-board-title">Your lot tonight</p>
        <p className="beaconMuted">Checking who&rsquo;s out&hellip;</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="beaconCard beaconBoard" aria-labelledby="beacon-board-title">
        <p className="beaconKicker" id="beacon-board-title">Your lot tonight</p>
        <p className="beaconMuted">Couldn&rsquo;t load who&rsquo;s out right now.</p>
      </section>
    );
  }

  if (state.kind === "empty") {
    return (
      <section className="beaconCard beaconBoard" aria-labelledby="beacon-board-title">
        <p className="beaconKicker" id="beacon-board-title">Your lot tonight</p>
        <p className="beaconMuted">Nobody in your lot is out tonight yet.</p>
        <p className="beaconPrivacy">
          Mutual follows only. Turn on out tonight above when you head out.
        </p>
        <p className="beaconPrivacy">
          <Link className="beaconBoardFindLot" href="/social">
            Find your lot
          </Link>
          {" "}
          to search handles or send an invite.
        </p>
      </section>
    );
  }

  return (
    <section className="beaconCard beaconBoard" aria-labelledby="beacon-board-title">
      <p className="beaconKicker" id="beacon-board-title">Your lot tonight</p>
      <ul className="beaconBoardList">
        {state.rows.map((row) => (
          <li key={row.handle} className="beaconBoardRow">
            <Link className="beaconBoardLink" href={`/u/${encodeURIComponent(row.handle)}`}>
              <HandleAvatar
                handle={row.handle}
                avatarUrl={row.avatarUrl}
                className="beaconBoardAvatar"
                imageClassName="beaconBoardAvatar"
                size={36}
              />
              <span className="beaconBoardCopy">
                <span className="beaconBoardLine">
                  <span className="beaconBoardHandle">{displayHandle(row.handle)}</span>
                  <span className="beaconBoardVerb"> is out</span>
                  {row.areaName ? (
                    <span className="beaconBoardWhere"> in {row.areaName}</span>
                  ) : null}
                </span>
                {row.note ? <span className="beaconBoardNote">{row.note}</span> : null}
                {row.ago ? (
                  <time className="beaconBoardMeta" dateTime={row.createdAt}>
                    {row.ago}
                  </time>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="beaconPrivacy">Mutual follows only. Clears on its own in twelve hours.</p>
    </section>
  );
}
