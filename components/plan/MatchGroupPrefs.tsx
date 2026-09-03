"use client";

import { useCallback, useEffect, useState } from "react";

import {
  GROUP_PREF_ATMOSPHERE_CHIPS,
  GROUP_PREF_BUDGET_BANDS,
  type GroupPrefAtmosphereChip,
  type GroupPrefBudgetBand,
  type GroupPrefsOverlap,
  type MatePreference,
} from "@/lib/groupPrefs";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";

type Props = {
  planId: string;
  memberId: string;
  memberToken: string;
  isHost: boolean;
};

type DraftPref = {
  budgetBand?: GroupPrefBudgetBand;
  atmosphereChip?: GroupPrefAtmosphereChip;
  zeroProof?: boolean;
  accessibilityRequired?: boolean;
  weatherShelterRequired?: boolean;
};

function operationKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const EMPTY_OVERLAP: GroupPrefsOverlap = {
  mateCount: 0,
  hardConstraints: {
    budgetBand: null,
    budgetLabel: null,
    zeroProofRequired: false,
    accessibilityRequired: false,
    weatherShelterRequired: false,
    sharedAtmosphereChips: [],
  },
  softScore: 0,
  scoreLabel: "No picks yet",
  summaryLabels: ["waiting on mate picks"],
  mustHaveLabels: [],
};

export default function MatchGroupPrefs({ planId, memberId, memberToken, isHost }: Props) {
  const [draft, setDraft] = useState<DraftPref>({});
  const [prefs, setPrefs] = useState<MatePreference[]>([]);
  const [overlap, setOverlap] = useState<GroupPrefsOverlap>(EMPTY_OVERLAP);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [shared, setShared] = useState(false);

  const refresh = useCallback(async () => {
    if (!memberToken) return;
    try {
      const response = await fetch(`/api/plans/${planId}/group-prefs`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${memberToken}` },
      });
      if (!response.ok) {
        discardBody(response);
        return;
      }
      const body = await response.json() as { prefs?: MatePreference[]; overlap?: GroupPrefsOverlap };
      setPrefs(Array.isArray(body.prefs) ? body.prefs : []);
      setOverlap(body.overlap && typeof body.overlap === "object" ? body.overlap : EMPTY_OVERLAP);
      const mine = Array.isArray(body.prefs) ? body.prefs.find((pref) => pref.mateId === memberId) : null;
      setShared(Boolean(mine));
    } catch {
      // Keep the last confirmed shared prefs during a transient failure.
    }
  }, [memberId, memberToken, planId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const myPref = prefs.find((pref) => pref.mateId === memberId) ?? null;
  const budgetBand = draft.budgetBand ?? myPref?.budgetBand ?? "";
  const atmosphereChip = draft.atmosphereChip ?? myPref?.atmosphereChips[0] ?? "";
  const zeroProof = draft.zeroProof ?? myPref?.zeroProof ?? false;
  const accessibilityRequired = draft.accessibilityRequired ?? myPref?.accessibilityRequired ?? false;
  const weatherShelterRequired = draft.weatherShelterRequired ?? myPref?.weatherShelterRequired ?? false;

  async function save(next: DraftPref) {
    const nextBudget = next.budgetBand ?? budgetBand;
    const nextAtmosphere = next.atmosphereChip ?? atmosphereChip;
    const nextZeroProof = next.zeroProof ?? zeroProof;
    const nextAccess = next.accessibilityRequired ?? accessibilityRequired;
    const nextWeather = next.weatherShelterRequired ?? weatherShelterRequired;
    setDraft({
      budgetBand: nextBudget || undefined,
      atmosphereChip: nextAtmosphere || undefined,
      zeroProof: nextZeroProof,
      accessibilityRequired: nextAccess,
      weatherShelterRequired: nextWeather,
    });
    if (!nextBudget || !nextAtmosphere) {
      setStatus("Pick a budget and a vibe to save.");
      return;
    }
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`/api/plans/${planId}/group-prefs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${memberToken}`,
          "idempotency-key": operationKey(),
        },
        body: JSON.stringify({
          budgetBand: nextBudget,
          atmosphereChip: nextAtmosphere,
          zeroProof: nextZeroProof,
          accessibilityRequired: nextAccess,
          weatherShelterRequired: nextWeather,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        pref?: MatePreference;
        overlap?: GroupPrefsOverlap;
        error?: unknown;
      };
      if (!response.ok) {
        setStatus(errorMessageFrom(body, "Could not share these picks yet."));
        return;
      }
      if (body.overlap) setOverlap(body.overlap);
      setShared(true);
      setDraft({});
      setStatus("Saved and shared with this plan.");
      await refresh();
    } catch {
      setStatus("Could not share these picks yet.");
    } finally {
      setPending(false);
    }
  }

  async function clearPrefs() {
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`/api/plans/${planId}/group-prefs`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${memberToken}` },
      });
      const body = await response.json().catch(() => ({})) as { overlap?: GroupPrefsOverlap; error?: unknown };
      if (!response.ok) {
        setStatus(errorMessageFrom(body, "Could not clear shared picks."));
        return;
      }
      if (body.overlap) setOverlap(body.overlap);
      setShared(false);
      setDraft({});
      setStatus("Shared picks cleared.");
      await refresh();
    } catch {
      setStatus("Could not clear shared picks.");
    } finally {
      setPending(false);
    }
  }

  const summary = overlap.summaryLabels.join(", ");
  const meta = overlap.mateCount > 1
    ? `${overlap.scoreLabel}, ${overlap.softScore}%`
    : overlap.mateCount === 1
      ? "Waiting for another mate to save shared picks."
      : "No shared picks on this plan yet.";
  const mustHaves = overlap.mustHaveLabels.join(", ");

  return (
    <section className="matchGroupPrefs" aria-labelledby="match-group-prefs-title">
      <div className="matchGroupPrefs__heading">
        <div>
          <p className="matchGroupPrefs__eyebrow">Sort My Night P1</p>
          <h4 id="match-group-prefs-title">Match the group</h4>
        </div>
        <span>{shared ? "Shared with this plan" : "Not shared yet"}</span>
      </div>
      <p className="matchGroupPrefs__intro">
        Pick a budget, a vibe and optional needs. Saved picks are shared with everyone on this plan.
      </p>

      <div className="matchGroupPrefs__field">
        <strong>Budget</strong>
        <div className="matchGroupPrefs__chips" role="group" aria-label="Budget preference">
          {GROUP_PREF_BUDGET_BANDS.map((band) => (
            <button
              key={band.id}
              type="button"
              className="matchGroupPrefs__chip"
              aria-pressed={budgetBand === band.id}
              disabled={pending}
              onClick={() => void save({ budgetBand: band.id })}
            >
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className="matchGroupPrefs__field">
        <strong>Vibe</strong>
        <div className="matchGroupPrefs__chips" role="group" aria-label="Atmosphere preference">
          {GROUP_PREF_ATMOSPHERE_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="matchGroupPrefs__chip"
              aria-pressed={atmosphereChip === chip.id}
              disabled={pending}
              onClick={() => void save({ atmosphereChip: chip.id })}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="matchGroupPrefs__actions">
        <button
          type="button"
          className="matchGroupPrefs__chip"
          aria-pressed={zeroProof}
          disabled={pending}
          onClick={() => void save({ zeroProof: !zeroProof })}
        >
          Zero-proof needed
        </button>
        <button
          type="button"
          className="matchGroupPrefs__chip"
          aria-pressed={accessibilityRequired}
          disabled={pending}
          onClick={() => void save({ accessibilityRequired: !accessibilityRequired })}
        >
          Step-free access
        </button>
        <button
          type="button"
          className="matchGroupPrefs__chip"
          aria-pressed={weatherShelterRequired}
          disabled={pending}
          onClick={() => void save({ weatherShelterRequired: !weatherShelterRequired })}
        >
          Covered shelter
        </button>
        <button type="button" className="planCollab__quiet" onClick={() => void clearPrefs()} disabled={pending}>
          Clear my picks
        </button>
      </div>

      {isHost && mustHaves ? (
        <output className="matchGroupPrefs__mustHaves" aria-live="polite">
          Must-haves for this plan: {mustHaves}. Shared with the crew for this night.
        </output>
      ) : null}

      <output className="matchGroupPrefs__summary" aria-live="polite">
        Crew overlap: {summary || "waiting on mate picks"}. {meta}
      </output>
      {status ? <p className="matchGroupPrefs__status" role="status">{status}</p> : null}
    </section>
  );
}
