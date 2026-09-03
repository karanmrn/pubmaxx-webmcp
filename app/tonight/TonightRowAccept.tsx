"use client";

// Keep and its failure travel together. The acceptance failure belongs to one
// row, so it renders beside that row's own Keep button and never as a single
// page-level alert above the whole list.

import {
  tonightRowAcceptanceError,
  type TonightAcceptanceError,
  type TonightEvidenceKind,
} from "@/lib/tonightAcceptance";

/** What this row was observed by, and when. The two travel together, because a
 *  date without the read it came from is what let a Ticketmaster listing be
 *  recorded as a what's-on observation. */
export type TonightRowEvidence = {
  observedAt: string;
  kind: TonightEvidenceKind;
};

export function TonightRowAccept({
  venueId,
  familyKey,
  evidence,
  placeName,
  className,
  label,
  acceptanceError,
  onAccept,
}: {
  venueId: string;
  familyKey: string;
  evidence: TonightRowEvidence;
  placeName: string;
  className: string;
  label: string;
  acceptanceError: TonightAcceptanceError | null;
  onAccept: (venueId: string, familyKey: string, evidence: TonightRowEvidence) => void;
}) {
  const message = tonightRowAcceptanceError(acceptanceError, venueId, familyKey);
  return (
    <>
      <button
        type="button"
        className={`${className} pressable`}
        aria-label={`Keep ${placeName} for tonight`}
        onClick={() => onAccept(venueId, familyKey, evidence)}
      >
        {label}
      </button>
      {message ? (
        <p className="tonightAcceptanceError" role="alert">{message}</p>
      ) : null}
    </>
  );
}

export default TonightRowAccept;
