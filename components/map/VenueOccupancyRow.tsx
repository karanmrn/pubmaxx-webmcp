"use client";

// One-tap crowd report on the venue sheet. Desk mode may reuse the hook;
// this row stays the only live copy on the sheet.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  OCCUPANCY_LEVELS,
  OCCUPANCY_LEVEL_LABELS,
  OCCUPANCY_RECEIPT_HOLD_MS,
  occupancyReadingLine,
  occupancySignInHref,
  occupancyWriteReceiptLine,
  type OccupancyLevel,
} from "@/lib/occupancy";

import {
  flagVenueOccupancy,
  trackOccupancyRead,
  useVenueOccupancy,
} from "@/components/map/useVenueOccupancy";

import "./venueOccupancy.css";

export type VenueOccupancyRowProps = {
  venueId: string;
  active?: boolean;
  surface?: "venue-sheet" | "pal";
  revealRecord?: boolean;
  revealRecordLate?: boolean;
};

export default function VenueOccupancyRow({
  venueId,
  active = true,
  surface = "venue-sheet",
  revealRecord = false,
  revealRecordLate = false,
}: VenueOccupancyRowProps) {
  const { user, session } = useAuth();
  const viewerSession = useViewerSession();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const { reading, report, reporting, error } = useVenueOccupancy(venueId, active);
  const [receipt, setReceipt] = useState<{ venueId: string; line: string } | null>(
    null,
  );
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(() => new Set());
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const receiptLine = receipt?.venueId === venueId ? receipt.line : null;

  const line = useMemo(() => {
    if (!reading) return "Checking how busy it is.";
    return occupancyReadingLine(reading);
  }, [reading]);

  useEffect(() => {
    if (!reading || receiptLine) return;
    trackOccupancyRead(venueId, reading.state);
  }, [venueId, reading, receiptLine]);

  // The receipt thanks the tap that made it; it may never stand in for the
  // reading once its own "just now" stops being true.
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setReceipt(null), OCCUPANCY_RECEIPT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [receipt]);

  async function onTap(level: OccupancyLevel) {
    if (!auth) return;
    const result = await report(level, auth);
    if (!result.ok) return;
    trackEvent("occupancy_reported", { level, surface });
    trackOccupancyRead(venueId, result.reading.state);
    setReceipt({
      venueId,
      line: occupancyWriteReceiptLine(level, result.reading),
    });
  }

  async function onFlag() {
    const id = reading?.id;
    if (!id || flaggedIds.has(id) || flagging) return;
    setFlagging(true);
    setFlagError(null);
    const result = await flagVenueOccupancy(venueId, id, auth);
    setFlagging(false);
    if (!result.ok) {
      setFlagError(result.error);
      return;
    }
    setFlaggedIds((prev) => new Set(prev).add(id));
  }

  const shown = receiptLine ?? line;
  const empty = !receiptLine && !reading?.now;
  const revealDatedReading =
    revealRecord && !receiptLine && reading?.now != null && reading.ageMinutes != null;

  return (
    <section className="venueOccupancy" aria-label="How busy it is right now">
      <h3 className="venueOccupancyQuestion">How busy is it right now?</h3>
      <p
        className={
          [
            empty ? "venueOccupancyReading venueOccupancyReading--empty" : "venueOccupancyReading",
            revealDatedReading ? "venueRevealRecord" : "",
          ]
            .filter(Boolean)
            .join(" ")
        }
        data-reveal-delay={revealDatedReading && !revealRecordLate ? "2" : undefined}
      >
        {shown}
      </p>
      <p className="venueOccupancy__srOnly" role="status">
        {receiptLine ?? ""}
      </p>
      {auth ? (
        <div className="venueOccupancyTaps" role="group" aria-label="Report how busy it is">
          {OCCUPANCY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className="venueOccupancyTap pressable"
              disabled={reporting}
              onClick={() => void onTap(level)}
            >
              {OCCUPANCY_LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
      ) : viewerSession.signedOut ? (
        <p className="venueOccupancySignIn">
          <Link href={occupancySignInHref(venueId)}>Sign in to report</Link>
        </p>
      ) : null}
      {reading?.id && reading.now ? (
        flaggedIds.has(reading.id) ? (
          <p className="venueOccupancyFlagged" role="status">
            Reported. We&rsquo;ll take a look.
          </p>
        ) : (
          <p className="venueOccupancyFlag">
            <button
              type="button"
              className="reportBtn"
              disabled={flagging}
              onClick={() => void onFlag()}
              aria-label="Report this crowd reading"
            >
              Report
            </button>
            {flagError ? <small role="status">{flagError}</small> : null}
          </p>
        )
      ) : null}
      {error ? (
        <p className="venueOccupancyError" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
