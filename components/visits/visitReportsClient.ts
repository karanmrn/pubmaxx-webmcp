"use client";

// Client plumbing for the Visit Report surface: the venue read, account-bound
// create write, and public flag.

import {
  accountBoundFetch,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import type {
  Busyness,
  Noise,
  Seating,
  ServiceWait,
  VisitReportDTO,
  VisitReportReadStatus,
} from "@/lib/visitReports";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";

export type VisitReportVenueRead = {
  status: VisitReportReadStatus;
  reports: VisitReportDTO[];
};

export type VisitReportDraft = {
  venueId: string;
  visitedAt: string;
  busyness?: Busyness | null;
  noise?: Noise | null;
  seating?: Seating | null;
  serviceWait?: ServiceWait | null;
  note?: string;
};

export type VisitReportPostResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      status?: "sign_in_required" | "onboarding_required";
    };

/** Read a venue's visit reports. A network failure becomes a degraded read so
 * the panel never writes "nothing here" when it could not check. */
export async function fetchVisitReports(
  venueId: string,
): Promise<VisitReportVenueRead | null> {
  try {
    const res = await fetch(
      `/api/visit-reports?venueId=${encodeURIComponent(venueId)}`,
    );
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return (await res.json()) as VisitReportVenueRead;
  } catch {
    return null;
  }
}

/** Queue one report for moderator review. The server derives reporter identity
 * from the request and ignores any client identity claim. */
export async function reportVisitReport(id: string): Promise<void> {
  const res = await fetch("/api/visit-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "report", id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errorMessageFrom(body, "Couldn't report this visit note just now."));
  }
}

/** Submit an account-bound visit report. Auth and onboarding refusals remain
 * typed so the shared contribution gate can close the composer. */
export async function postVisitReport(
  draft: VisitReportDraft,
  auth: AccountAuthSnapshot,
): Promise<VisitReportPostResult> {
  const res = await accountBoundFetch(auth, "/api/visit-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      status?: unknown;
    };
    const status =
      body.status === "sign_in_required" ||
      body.status === "onboarding_required"
        ? body.status
        : undefined;
    return {
      ok: false,
      error: errorMessageFrom(body, "Couldn't save your visit report just now."),
      ...(status ? { status } : {}),
    };
  }
  return { ok: true };
}
