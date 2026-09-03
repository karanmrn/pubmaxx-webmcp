"use client";

// One Visit Report surface for every venue page. It reads individual,
// contributor-attributed accounts newest first and opens one compact composer.
// A row is a claim about one dated visit, never a score or verified venue fact.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  useAccountScopedDraft,
  useContributionGate,
} from "@/components/identity/ContributionGateDialog";
import {
  accountComposerAuth,
  sameAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  BUSYNESS_VALUES,
  earliestVisitedAt,
  latestVisitedAt,
  MAX_VISIT_AGE_DAYS,
  MAX_VISIT_NOTE,
  NOISE_VALUES,
  SEATING_VALUES,
  SERVICE_WAIT_VALUES,
  type Busyness,
  type Noise,
  type Seating,
  type ServiceWait,
  type VisitReportDTO,
  type VisitReportReadStatus,
} from "@/lib/visitReports";

import {
  fetchVisitReports,
  postVisitReport,
  reportVisitReport,
  type VisitReportVenueRead,
} from "./visitReportsClient";

import "./visitReports.css";

/** Newest accounts shown on the Overview peek before Lore owns the full lane. */
export const VISIT_REPORT_PEEK_LIMIT = 2;

export type VisitReportPanelMode = "full" | "peek";

export type VisitReportPanelProps = {
  venueId: string;
  venueName: string;
  /**
   * False while the panel is mounted but out of view (a tab the viewer hasn't
   * opened). It defers the venue read until the surface is first looked at; it
   * never unmounts, so a half-written account survives a trip to another tab.
   */
  active?: boolean;
  /**
   * "peek" is the Overview read-only strip (newest one or two accounts, or an
   * honest empty/degraded line). "full" keeps the Story/Lore composer + list.
   */
  mode?: VisitReportPanelMode;
  /**
   * Opens the full Visit Report surface on Lore. Peek mode only; Overview
   * wires this to the inspector tab switch.
   */
  onOpenFull?: () => void;
};

export function visitReportComposerMode(
  open: boolean,
  accountId: string | null,
): "open" | "closed" | "sign_in_required" {
  if (!accountId) return "sign_in_required";
  return open ? "open" : "closed";
}

/** Empty-list copy for a finished venue read. Degraded never collapses to "no visits". */
export function visitReportEmptyCopy(status: VisitReportReadStatus): string {
  if (status === "ready") {
    return "No visits have been written up here yet.";
  }
  return "We couldn't check the visit notes here just now.";
}

/** Peek keeps the newest one or two; the full lane lists every returned account. */
export function visitReportsForPanel(
  reports: VisitReportDTO[],
  mode: VisitReportPanelMode,
): VisitReportDTO[] {
  return mode === "peek" ? reports.slice(0, VISIT_REPORT_PEEK_LIMIT) : reports;
}

export function visitReportPeekAffordanceLabel(
  read: VisitReportVenueRead | null,
): string {
  if (read === null) return "Open Lore";
  if (read.reports.length > 0) return "More on Lore";
  if (read.status === "ready") return "Write yours on Lore";
  return "Open Lore";
}

const BUSYNESS_LABELS: Record<Busyness, string> = {
  quiet: "Quiet",
  steady: "Steady",
  rammed: "Rammed",
};

const NOISE_LABELS: Record<Noise, string> = {
  "easy-to-talk": "Easy to talk",
  loud: "Loud",
  "had-to-shout": "Had to shout",
};

const SEATING_LABELS: Record<Seating, string> = {
  plenty: "Plenty",
  tight: "Tight",
  standing: "Standing",
};

const SERVICE_WAIT_LABELS: Record<ServiceWait, string> = {
  quick: "Quick",
  "some-wait": "Some wait",
  long: "Long wait",
};

type VisitReportDraft = {
  visitedAt: string;
  busyness: Busyness | null;
  noise: Noise | null;
  seating: Seating | null;
  serviceWait: ServiceWait | null;
  note: string;
};

function visitDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function reportDetails(report: VisitReportDTO): string[] {
  return [
    report.busyness
      ? `Crowd: ${BUSYNESS_LABELS[report.busyness].toLowerCase()}`
      : "",
    report.noise ? `Noise: ${NOISE_LABELS[report.noise].toLowerCase()}` : "",
    report.seating
      ? `Seats: ${SEATING_LABELS[report.seating].toLowerCase()}`
      : "",
    report.serviceWait
      ? `Bar wait: ${SERVICE_WAIT_LABELS[report.serviceWait].toLowerCase()}`
      : "",
  ].filter(Boolean);
}

function VisitReportRow({
  report,
  flagged,
  flagging,
  onFlag,
  readOnly = false,
}: {
  report: VisitReportDTO;
  flagged: boolean;
  flagging: boolean;
  onFlag: (id: string) => void;
  /** Peek strips reader actions; the full Lore lane keeps flagging. */
  readOnly?: boolean;
}) {
  const details = reportDetails(report);
  return (
    <article className="visitReportRow">
      <p className="visitReportByline">
        <strong>@{report.handle}</strong>
        <span aria-hidden="true"> · </span>
        <time dateTime={report.visitedAt}>
          Visited {visitDayLabel(report.visitedAt)}
        </time>
      </p>
      {report.note ? <p className="visitReportAccount">{report.note}</p> : null}
      {details.length > 0 ? (
        <ul className="visitReportFacts" aria-label="What they found">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <button
          type="button"
          className="visitReportFlag"
          disabled={flagged || flagging}
          onClick={() => onFlag(report.id)}
          aria-label={`Report ${report.handle}'s visit account`}
        >
          {flagged ? "Reported" : flagging ? "Reporting…" : "Report"}
        </button>
      )}
    </article>
  );
}

function ChoiceGroup<T extends string>({
  label,
  values,
  labels,
  selected,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T | null;
  onSelect: (value: T | null) => void;
}) {
  return (
    <fieldset className="visitReportChoiceGroup">
      <legend>{label}</legend>
      <div className="visitReportChips">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className={selected === value ? "visitChip active" : "visitChip"}
            aria-pressed={selected === value}
            onClick={() => onSelect(selected === value ? null : value)}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// A panel belongs to ONE pub, so the venue is its identity, not a prop it
// re-reads. Keying the mount means a pin switch on the map sheet drops the
// previous pub's accounts, flags, feedback line, half-typed draft and any
// in-flight write together, rather than showing them under the new pub's name.
export default function VisitReportPanel({
  venueId,
  venueName,
  active = true,
  mode = "full",
  onOpenFull,
}: VisitReportPanelProps) {
  return (
    <VenueVisitReports
      key={`${venueId}:${mode}`}
      venueId={venueId}
      venueName={venueName}
      active={active}
      mode={mode}
      onOpenFull={onOpenFull}
    />
  );
}

function VenueVisitReports({
  venueId,
  venueName,
  active = true,
  mode = "full",
  onOpenFull,
}: VisitReportPanelProps) {
  const peek = mode === "peek";
  const now = new Date();
  const latest = latestVisitedAt(now);
  // The composer MIRRORS the server's window (lib/visitReports); it never
  // replaces it, so a post that skips this card meets the same bound.
  const earliest = earliestVisitedAt(now);
  const { user, session, rejectedContributionAuth } = useAuth();
  const { requestContribution, contributionGateDialog } = useContributionGate();
  const [read, setRead] = useState<VisitReportVenueRead | null>(null);
  const [openAuth, setOpenAuth] = useState<AccountAuthSnapshot | null>(null);
  const [draft, setDraft, clearDraft] = useAccountScopedDraft<VisitReportDraft>(
    user?.id ?? null,
    () => ({
      visitedAt: latest,
      busyness: null,
      noise: null,
      seating: null,
      serviceWait: null,
      note: "",
    }),
  );
  const [saving, setSaving] = useState(false);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const composerAuth = accountComposerAuth(
    user?.id ?? null,
    session,
    rejectedContributionAuth,
  );
  const composerMode = visitReportComposerMode(
    sameAccountAuth(openAuth, composerAuth),
    composerAuth?.userId ?? null,
  );
  const visitedAt = draft?.visitedAt ?? latest;
  const busyness = draft?.busyness ?? null;
  const noise = draft?.noise ?? null;
  const seating = draft?.seating ?? null;
  const serviceWait = draft?.serviceWait ?? null;
  const note = draft?.note ?? "";

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const nextRead = await fetchVisitReports(venueId);
      if (cancelled) return;
      setRead(nextRead ?? { status: "degraded", reports: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [active, venueId]);

  const hasDraft =
    busyness !== null ||
    noise !== null ||
    seating !== null ||
    serviceWait !== null ||
    note.trim() !== "";

  async function submit() {
    if (!draft || !composerAuth) return;
    if (!visitedAt) {
      setFeedback({ kind: "error", text: "Add the day you were there." });
      return;
    }
    if (visitedAt > latest || visitedAt < earliest) {
      setFeedback({
        kind: "error",
        text: `Pick the day you were there, from the last ${MAX_VISIT_AGE_DAYS} days.`,
      });
      return;
    }
    if (!hasDraft) {
      setFeedback({
        kind: "error",
        text: "Add one thing you found on the visit.",
      });
      return;
    }
    setFeedback(null);
    await requestContribution(async (auth) => {
      if (!sameAccountAuth(auth, composerAuth)) {
        return { status: "sign_in_required" };
      }
      setSaving(true);
      try {
        const result = await postVisitReport(
          {
            venueId,
            visitedAt,
            busyness,
            noise,
            seating,
            serviceWait,
            note: note.trim(),
          },
          auth,
        );
        if (!result.ok) {
          if (result.status) {
            return { status: result.status, error: result.error };
          }
          setFeedback({ kind: "error", text: result.error });
          return;
        }
        const nextRead = await fetchVisitReports(venueId);
        setRead(nextRead ?? { status: "degraded", reports: [] });
        clearDraft();
        setOpenAuth((current) => sameAccountAuth(current, auth) ? null : current);
        setFeedback({
          kind: "ok",
          text: "Saved. Your visit is on this pub's page.",
        });
      } catch (error) {
        setFeedback({
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "Couldn't save this visit just now.",
        });
      } finally {
        setSaving(false);
      }
    });
  }

  async function flag(id: string) {
    setFlaggingId(id);
    setFeedback(null);
    try {
      await reportVisitReport(id);
      setFlaggedIds((current) => new Set(current).add(id));
      setFeedback({ kind: "ok", text: "Reported for a moderator to check." });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Couldn't report this visit just now.",
      });
    } finally {
      setFlaggingId(null);
    }
  }

  const headingId = peek
    ? `visitReports-peek-${venueId}`
    : `visitReports-${venueId}`;
  const visibleReports =
    read === null ? [] : visitReportsForPanel(read.reports, mode);

  return (
    <section
      className={peek ? "visitReportPanel visitReportPanel--peek" : "visitReportPanel"}
      aria-labelledby={headingId}
    >
      <div className="visitReportHead">
        <div>
          <span className="visitReportLabel">On the night</span>
          <h3 id={headingId} className="visitReportTitle">
            Visits, written up
          </h3>
        </div>
        {peek ? (
          onOpenFull ? (
            <button
              type="button"
              className="visitReportOpen"
              onClick={onOpenFull}
            >
              {visitReportPeekAffordanceLabel(read)}
            </button>
          ) : null
        ) : composerMode !== "open" ? (
          <button
            type="button"
            className="visitReportOpen"
            onClick={() => {
              void requestContribution((auth) => {
                if (!sameAccountAuth(auth, composerAuth)) {
                  return { status: "sign_in_required" };
                }
                setOpenAuth(auth);
              });
            }}
          >
            {composerMode === "sign_in_required"
              ? "Sign in to contribute"
              : "Write yours"}
          </button>
        ) : null}
      </div>

      {read === null ? (
        <p className="visitReportEmpty" role="status">
          Checking visit notes.
        </p>
      ) : visibleReports.length > 0 ? (
        <div className="visitReportList">
          {visibleReports.map((report) => (
            <VisitReportRow
              key={report.id}
              report={report}
              flagged={flaggedIds.has(report.id)}
              flagging={flaggingId === report.id}
              onFlag={(id) => void flag(id)}
              readOnly={peek}
            />
          ))}
        </div>
      ) : (
        <p className="visitReportEmpty">{visitReportEmptyCopy(read.status)}</p>
      )}

      {!peek && composerMode === "open" ? (
        <div className="visitReportCard">
          <div className="visitReportCardHead">
            <div>
              <span className="visitReportCardTitle">
                What was {venueName} like?
              </span>
              <p>Pick what you saw. Add one short line if it helps.</p>
            </div>
            <button
              type="button"
              className="visitReportDismiss"
              aria-label="Close visit report"
              onClick={() => setOpenAuth(null)}
            >
              ×
            </button>
          </div>

          <label className="visitReportDate">
            <span>When were you there?</span>
            <input
              type="date"
              value={visitedAt}
              min={earliest}
              max={latest}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  visitedAt: event.target.value,
                }))
              }
            />
            <small>Visits from the last {MAX_VISIT_AGE_DAYS} days.</small>
          </label>

          <ChoiceGroup
            label="How busy?"
            values={BUSYNESS_VALUES}
            labels={BUSYNESS_LABELS}
            selected={busyness}
            onSelect={(value) =>
              setDraft((current) => ({ ...current, busyness: value }))
            }
          />
          <ChoiceGroup
            label="Could you hear each other?"
            values={NOISE_VALUES}
            labels={NOISE_LABELS}
            selected={noise}
            onSelect={(value) =>
              setDraft((current) => ({ ...current, noise: value }))
            }
          />
          <ChoiceGroup
            label="Finding a seat?"
            values={SEATING_VALUES}
            labels={SEATING_LABELS}
            selected={seating}
            onSelect={(value) =>
              setDraft((current) => ({ ...current, seating: value }))
            }
          />
          <ChoiceGroup
            label="Wait at the bar?"
            values={SERVICE_WAIT_VALUES}
            labels={SERVICE_WAIT_LABELS}
            selected={serviceWait}
            onSelect={(value) =>
              setDraft((current) => ({ ...current, serviceWait: value }))
            }
          />

          <label className="visitReportNoteWrap">
            <span>One short account</span>
            <textarea
              className="visitReportNote"
              value={note}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value.slice(0, MAX_VISIT_NOTE),
                }))
              }
              maxLength={MAX_VISIT_NOTE}
              rows={3}
              placeholder="What did you find when you walked in?"
            />
            <small>{MAX_VISIT_NOTE - note.length} characters left</small>
          </label>

          <button
            type="button"
            className="visitReportSubmit"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Add visit account"}
          </button>
          <p className="visitReportTrust">
            This is your account of one visit. It is shown with your handle and
            the day, not as a checked fact about the pub.
          </p>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={
            feedback.kind === "error" ? "visitReportError" : "visitReportOk"
          }
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
      {contributionGateDialog}
    </section>
  );
}
