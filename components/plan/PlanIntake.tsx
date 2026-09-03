"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, LocateFixed, MapPin, RotateCcw } from "lucide-react";

import { nearestNightPatch } from "@/lib/nearestNightPatch";
import { writeRememberedArea } from "@/lib/nightPatches";
import {
  PLAN_ACCESSIBILITY_NEEDS,
  PLAN_BUDGET_OPTIONS,
  PLAN_INTAKE_STEPS,
  PLAN_TIME_WINDOWS,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  nightAreaForPlanIntakePatch,
  nextLondonOccurrenceIso,
  planIntakeStepHasAnswer,
  planIntakeSummary,
  reopenPlanIntakeStep,
  settlePlanIntakeStep,
  skipRemainingPlanIntake,
  type PlanAccessibilityNeed,
  type PlanIntakeDraft,
  type PlanIntakeStep,
} from "@/lib/planIntake";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import type { Budget } from "@/lib/nightPlanning";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";

const STEP_COPY: Record<PlanIntakeStep, { short: string; eyebrow: string; title: string; note: string }> = {
  area: {
    short: "Area",
    eyebrow: "Start nearby",
    title: "Where should the night happen?",
    note: "Pick the area name your group uses. We'll remember it on this device.",
  },
  "time-window": {
    short: "Time",
    eyebrow: "Set the rhythm",
    title: "When are you heading out?",
    note: "A broad window is enough. You can set the exact first pint later.",
  },
  "group-size": {
    short: "Group",
    eyebrow: "Make room",
    title: "How many people?",
    note: "This helps shape space, pace and getting-in guidance.",
  },
  budget: {
    short: "Budget",
    eyebrow: "Keep it comfortable",
    title: "What should the night cost?",
    note: "Choose a feel, then add a per-person ceiling only if you have one.",
  },
  accessibility: {
    short: "Access",
    eyebrow: "Plan for everyone",
    title: "Any access needs to protect?",
    note: "Choose every need that matters. We keep unchecked details visible in the route.",
  },
};

function updateAccessibility(
  draft: PlanIntakeDraft,
  need: PlanAccessibilityNeed,
): PlanIntakeDraft {
  const selected = draft.answers.accessibilityNeeds.includes(need);
  return {
    ...draft,
    answers: {
      ...draft.answers,
      accessibilityNeeds: selected
        ? draft.answers.accessibilityNeeds.filter((candidate) => candidate !== need)
        : [...draft.answers.accessibilityNeeds, need],
    },
  };
}

function advanceSingleValueStep(
  event: KeyboardEvent<HTMLInputElement>,
  draft: PlanIntakeDraft,
  onChange: (next: PlanIntakeDraft) => void,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  if (planIntakeStepHasAnswer(draft)) onChange(settlePlanIntakeStep(draft));
}

export default function PlanIntake({
  draft,
  onChange,
}: {
  draft: PlanIntakeDraft;
  onChange: (next: PlanIntakeDraft) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const hasRenderedRef = useRef(false);
  const draftRef = useRef(draft);
  const locationRequestRef = useRef(0);
  const [locationState, setLocationState] = useState<{
    kind: "idle" | "locating" | "success" | "error";
    message: string;
  }>({ kind: "idle", message: "" });
  const summary = useMemo(() => planIntakeSummary(draft), [draft]);
  const stepIndex = PLAN_INTAKE_STEPS.indexOf(draft.currentStep);
  const copy = STEP_COPY[draft.currentStep];

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => () => {
    locationRequestRef.current += 1;
  }, []);

  function cancelLocationRequest(): void {
    locationRequestRef.current += 1;
    setLocationState({ kind: "idle", message: "" });
  }

  function useCurrentLocation(): void {
    const requestId = locationRequestRef.current + 1;
    locationRequestRef.current = requestId;
    if (!navigator.geolocation) {
      setLocationState({
        kind: "error",
        message: "Location is not available in this browser. Pick an area instead.",
      });
      return;
    }

    setLocationState({ kind: "locating", message: "Finding your nearest night-out area…" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (locationRequestRef.current !== requestId || draftRef.current.currentStep !== "area") return;
        const patch = nearestNightPatch(coords.latitude, coords.longitude);
        if (!patch) {
          const finite = Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
          setLocationState({
            kind: "error",
            message: finite
              ? "That location is outside London. Pick an area to keep planning."
              : "We could not use that location. Try again or pick an area.",
          });
          return;
        }
        if (!nightAreaForPlanIntakePatch(patch.id)) {
          setLocationState({
            kind: "error",
            message: `${patch.label} is nearest, but exact route generation is not available there yet. Pick another area to keep planning.`,
          });
          return;
        }

        writeRememberedArea({ kind: "patch", id: patch.id });
        onChange({
          ...draftRef.current,
          answers: { ...draftRef.current.answers, area: patch.id },
        });
        setLocationState({
          kind: "success",
          message: `${patch.label} is your nearest supported area. Continue when you are ready.`,
        });
      },
      (error) => {
        if (locationRequestRef.current !== requestId || draftRef.current.currentStep !== "area") return;
        const message = error.code === error.PERMISSION_DENIED
          ? "Location access was denied. Pick an area or allow it in your browser settings."
          : error.code === error.TIMEOUT
            ? "We could not get your location in time. Try again or pick an area."
            : "We could not find your location. Check your signal or pick an area.";
        setLocationState({ kind: "error", message });
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
  }

  useEffect(() => {
    if (!hasRenderedRef.current) {
      hasRenderedRef.current = true;
      return;
    }
    if (!draft.completed) headingRef.current?.focus();
  }, [draft.completed, draft.currentStep]);

  if (draft.completed) {
    return (
      <section className="planIntake planIntake--complete" aria-labelledby="plan-intake-summary-title">
        <div className="planIntake__completeMark" aria-hidden="true"><Check size={18} /></div>
        <div className="planIntake__summaryBody">
          <p className="planIntake__eyebrow">Your night so far</p>
          <h2 id="plan-intake-summary-title">{summary.length ? summary.join(" · ") : "Start in your own words"}</h2>
          <p>{summary.length
            ? "Saved for later on this device. Lock it in below when you want a share link for the crew."
            : "No choices needed. Describe what matters and we will work from that."}</p>
          {summary.length ? (
            <div className="planIntake__summaryChips" aria-label="Saved planning details">
              {PLAN_INTAKE_STEPS.filter((step) => draft.settledSteps.includes(step) && !draft.skippedSteps.includes(step)).map((step) => (
                <button key={step} type="button" onClick={() => onChange(reopenPlanIntakeStep(draft, step))}>
                  {STEP_COPY[step].short}<span className="planComposer__srOnly">: edit</span>
                </button>
              ))}
            </div>
          ) : null}
          <PlanStopCountPicker
            value={draft.answers.stopCount}
            onChange={(stopCount) => onChange({ ...draft, answers: { ...draft.answers, stopCount } })}
          />
        </div>
        <button
          type="button"
          className="planIntake__tune"
          onClick={() => onChange(reopenPlanIntakeStep(draft, "area"))}
        >
          <RotateCcw size={16} aria-hidden="true" /> Tune details
        </button>
      </section>
    );
  }

  return (
    <section className="planIntake" aria-labelledby="plan-intake-title">
      <header className="planIntake__header">
        <div>
          <p className="planIntake__kicker">Shape the route</p>
          <p className="planIntake__count">Step {stepIndex + 1} of {PLAN_INTAKE_STEPS.length}</p>
        </div>
        <button
          type="button"
          className="planIntake__describe"
          onClick={() => {
            cancelLocationRequest();
            onChange(skipRemainingPlanIntake(draft));
          }}
        >
          Describe instead
        </button>
      </header>

      <p className="planIntake__palEntry">
        Not sure?{" "}
        <Link href="/pal/chat">Ask your Pub Pal…</Link>
      </p>

      <PlanStopCountPicker
        value={draft.answers.stopCount}
        onChange={(stopCount) => onChange({ ...draft, answers: { ...draft.answers, stopCount } })}
      />

      <ol className="planIntake__progress" aria-label="Plan details progress">
        {PLAN_INTAKE_STEPS.map((step, index) => {
          const settled = draft.settledSteps.includes(step);
          const skipped = draft.skippedSteps.includes(step);
          return (
            <li
              key={step}
              aria-current={step === draft.currentStep ? "step" : undefined}
              data-state={step === draft.currentStep ? "current" : settled ? "settled" : "upcoming"}
            >
              <span aria-hidden="true">{settled && !skipped ? <Check size={13} /> : index + 1}</span>
              <span>{STEP_COPY[step].short}{skipped ? " skipped" : ""}</span>
            </li>
          );
        })}
      </ol>

      <div className="planIntake__stage" key={draft.currentStep}>
        <p className="planIntake__eyebrow">{copy.eyebrow}</p>
        <h2 id="plan-intake-title" ref={headingRef} tabIndex={-1}>{copy.title}</h2>
        <p className="planIntake__note">{copy.note}</p>

        {draft.currentStep === "area" ? (
          <div className="planIntake__areaPicker">
            <button
              type="button"
              className="planIntake__locate"
              onClick={useCurrentLocation}
              disabled={locationState.kind === "locating"}
            >
              <LocateFixed size={17} aria-hidden="true" />
              {locationState.kind === "locating" ? "Finding your area…" : "Use my location"}
            </button>
            {locationState.kind !== "idle" ? (
              <p
                className={`planIntake__locationStatus${locationState.kind === "error" ? " planIntake__locationStatus--error" : ""}`}
                role={locationState.kind === "error" ? "alert" : "status"}
              >
                {locationState.message}
              </p>
            ) : null}
            <div className="planIntake__choices planIntake__choices--areas" role="group" aria-label="Choose an area">
              {NIGHT_PATCHES.map((patch) => (
                <button
                  key={patch.id}
                  type="button"
                  aria-pressed={draft.answers.area === patch.id}
                  onClick={() => {
                    cancelLocationRequest();
                    writeRememberedArea({ kind: "patch", id: patch.id });
                    onChange({ ...draft, answers: { ...draft.answers, area: patch.id } });
                  }}
                >
                  <MapPin size={16} aria-hidden="true" /> {patch.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {draft.currentStep === "time-window" ? (
          <div className="planIntake__choices planIntake__choices--cards" role="group" aria-label="Choose a time window">
            {PLAN_TIME_WINDOWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={draft.answers.timeWindow === option.id}
                onClick={() => {
                  onChange({
                    ...draft,
                    answers: {
                      ...draft.answers,
                      timeWindow: option.id,
                      exactStartIso: nextLondonOccurrenceIso(option.id),
                    },
                  });
                }}
              >
                <strong>{option.label}</strong><small>{option.note}</small>
              </button>
            ))}
            {draft.answers.timeWindow && draft.answers.exactStartIso ? (
              <label className="planIntake__exactTime" htmlFor="plan-intake-exact-time">
                Exact first pint
                <input
                  id="plan-intake-exact-time"
                  type="datetime-local"
                  value={londonDateTimeInputFromIso(draft.answers.exactStartIso) ?? ""}
                  onChange={(event) => {
                    const exactStartIso = londonDateTimeInputToIso(event.target.value, new Date());
                    onChange({ ...draft, answers: { ...draft.answers, exactStartIso } });
                  }}
                  onKeyDown={(event) => advanceSingleValueStep(event, draft, onChange)}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {draft.currentStep === "group-size" ? (
          <div className="planIntake__group">
            <div className="planIntake__numberChoices" role="group" aria-label="Quick group sizes">
              {[1, 2, 3, 4, 5, 6].map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={draft.answers.groupSize === size}
                  onClick={() => onChange({ ...draft, answers: { ...draft.answers, groupSize: size } })}
                >{size}</button>
              ))}
            </div>
            <label htmlFor="plan-intake-group-size">Or enter a group size</label>
            <input
              id="plan-intake-group-size"
              type="number"
              inputMode="numeric"
              min="1"
              max="30"
              value={draft.answers.groupSize ?? ""}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                const groupSize = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : null;
                onChange({ ...draft, answers: { ...draft.answers, groupSize } });
              }}
              onKeyDown={(event) => advanceSingleValueStep(event, draft, onChange)}
            />
          </div>
        ) : null}

        {draft.currentStep === "budget" ? (
          <div className="planIntake__budget">
            <div className="planIntake__choices planIntake__choices--cards" role="group" aria-label="Choose a budget">
              {PLAN_BUDGET_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={draft.answers.budget === option.budget}
                  onClick={() => onChange({ ...draft, answers: { ...draft.answers, budget: option.budget } })}
                >
                  <strong>{option.label}</strong><small>{option.note}</small>
                </button>
              ))}
            </div>
            <label htmlFor="plan-intake-budget-limit">Optional ceiling per person</label>
            <div className="planIntake__moneyInput">
              <span aria-hidden="true">£</span>
              <input
                id="plan-intake-budget-limit"
                type="number"
                inputMode="decimal"
                min="5"
                max="500"
                step="1"
                value={draft.answers.budgetLimitPence === null ? "" : draft.answers.budgetLimitPence / 100}
                onChange={(event) => {
                  const pounds = Number(event.target.value);
                  const limit = Number.isFinite(pounds) && pounds >= 5 && pounds <= 500
                    ? Math.round(pounds * 100)
                    : null;
                  onChange({
                    ...draft,
                    answers: {
                      ...draft.answers,
                      budget: (draft.answers.budget ?? "standard") as Budget,
                      budgetLimitPence: limit,
                    },
                  });
                }}
                onKeyDown={(event) => advanceSingleValueStep(event, draft, onChange)}
              />
            </div>
          </div>
        ) : null}

        {draft.currentStep === "accessibility" ? (
          <div className="planIntake__choices planIntake__choices--access" role="group" aria-label="Choose accessibility needs">
            {PLAN_ACCESSIBILITY_NEEDS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={draft.answers.accessibilityNeeds.includes(option.id)}
                onClick={() => onChange(updateAccessibility(draft, option.id))}
              >
                <span aria-hidden="true">{draft.answers.accessibilityNeeds.includes(option.id) ? <Check size={15} /> : null}</span>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="planIntake__actions">
        <button
          type="button"
          className="planIntake__back"
          disabled={stepIndex === 0}
          onClick={() => {
            const previous = PLAN_INTAKE_STEPS[stepIndex - 1];
            if (previous) onChange(reopenPlanIntakeStep(draft, previous));
          }}
        >Back</button>
        <div>
          <button
            type="button"
            className="planIntake__skip"
            onClick={() => {
              cancelLocationRequest();
              onChange(settlePlanIntakeStep(draft, { skip: true }));
            }}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="planIntake__continue"
            disabled={!planIntakeStepHasAnswer(draft)}
            onClick={() => {
              cancelLocationRequest();
              onChange(settlePlanIntakeStep(draft));
            }}
          >
            {stepIndex === PLAN_INTAKE_STEPS.length - 1 ? "Use these details" : "Continue"}
          </button>
        </div>
      </footer>
    </section>
  );
}
