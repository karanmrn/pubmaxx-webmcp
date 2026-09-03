"use client";

import type { SocialCrewPublicPreviewDTO } from "@/lib/socialCrew";
import { displayHandle } from "@/lib/handleDisplay";
import { crewStartsCaption } from "@/lib/socialCrewsUi";

export type PublicCrewJoinState = "none" | "pending" | "declined";

export default function PublicCrewPreview({
  preview,
  joinState,
  busy,
  problem,
  onAskToJoin,
}: {
  preview: SocialCrewPublicPreviewDTO;
  joinState: PublicCrewJoinState;
  busy: boolean;
  problem: string;
  onAskToJoin: () => void;
}) {
  const starts = crewStartsCaption(preview.startsAt);
  return (
    <>
      <header className="crewPage__head">
        <h1>{preview.title}</h1>
        <p className="crewPage__meta">
          <span>{displayHandle(preview.hostHandle)}</span>
          {starts ? <time dateTime={preview.startsAt}>{starts}</time> : null}
        </p>
      </header>

      <section aria-labelledby="public-crew-meeting-point">
        <h2 id="public-crew-meeting-point" className="crews__title">
          Meet at
        </h2>
        <p className="crews__note">{preview.meetingPoint.name}</p>
      </section>

      {problem ? (
        <p className="crews__problem" role="alert">
          {problem}
        </p>
      ) : null}

      {joinState === "pending" ? (
        <p className="crews__muted" role="status">
          Request sent. The host decides.
        </p>
      ) : joinState === "declined" ? (
        <p className="crews__muted" role="status">
          The host said no to this one.
        </p>
      ) : (
        <section className="crews__notice">
          <button
            type="button"
            className="crews__button crews__button--primary"
            disabled={busy}
            onClick={onAskToJoin}
          >
            {busy ? "Working…" : "Ask to join"}
          </button>
        </section>
      )}
    </>
  );
}
