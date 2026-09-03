"use client";

import { Mic, MicOff, ShieldCheck, Sparkles } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";

import { MapRouteTransferButton, type MapRouteResponse } from "@/components/plan/MapRouteTransferButton";

import PubmaxxLoadingEmber from "@/components/brand/PubmaxxLoadingEmber";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useAuth } from "@/components/auth/AuthProvider";
import { useTransientSpeechInput } from "@/components/plan/useTransientSpeechInput";
import AreaNewsBlock from "@/components/areanews/AreaNewsBlock";
import type { CityId } from "@/lib/cities";
import { getNightAreasForCity, type NightAreaSlug } from "@/lib/nightAreas";
import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanEndingRecommendation, PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import { shouldWarmMapIntent } from "@/lib/mapWarmup";
import { writeDeviceNightContext } from "@/lib/nightProfileClient";
import { planRouteTotalsFallbackLabel, resolvePlanRouteTotalLabel } from "@/lib/planRouteTotalsClient";
import { isPlanStopCount, normalizePlanStopCount, PLAN_STOP_COUNTS, type PlanStopCount } from "@/lib/planStopCount";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
import type { Venue } from "@/lib/venues";
import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";

type GeneratedStop = { venueId: string; venueName: string };

export type GeneratedMobilePlan = {
  stops: GeneratedStop[];
  context: NightContext;
  confidence: PlanningConfidence;
  budget: PlanBudgetSummary;
  routeTotals: PlanRouteTotals;
  endings: PlanEndingRecommendation[];
};

const MOODS = ["quiet", "lively", "historic", "music", "garden"] as const;
const PACES = ["easy pace", "balanced pace", "fast pace"] as const;

function responseError(body: unknown): string {
  return errorMessageFrom(body, "PUBMAXX could not build that route.");
}

export function MobilePlanActivation({
  cityId,
  initialNightArea,
  venuesById,
  onGenerated,
  mapRouteTransfer = false,
}: {
  cityId: CityId;
  initialNightArea: NightAreaSlug;
  venuesById?: ReadonlyMap<string, Venue>;
  onGenerated: (plan: GeneratedMobilePlan) => void;
  /** L12: when true, "Open Plan" carries the exact Route into the Plan draft. */
  mapRouteTransfer?: boolean;
}) {
  const { user } = useAuth();
  const areas = getNightAreasForCity(cityId);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<NightAreaSlug>(initialNightArea);
  const [areaTouched, setAreaTouched] = useState(false);
  const [daypart, setDaypart] = useState<NightContext["daypart"]>("evening");
  const [daypartTouched, setDaypartTouched] = useState(false);
  const [mood, setMood] = useState<(typeof MOODS)[number]>("lively");
  const [moodTouched, setMoodTouched] = useState(false);
  const [pace, setPace] = useState<(typeof PACES)[number]>("balanced pace");
  const [paceTouched, setPaceTouched] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState("");
  const [groupSize, setGroupSize] = useState(4);
  const [stopCount, setStopCount] = useState<PlanStopCount>(3);
  const [groupSizeTouched, setGroupSizeTouched] = useState(false);
  const [stepFree, setStepFree] = useState(false);
  const [zeroProof, setZeroProof] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    confidence: PlanningConfidence;
    budget: PlanBudgetSummary;
    routeTotalLabel: string;
    endings: PlanEndingRecommendation[];
    // L12: full grounded response carried for a zero-regeneration Plan transfer.
    mapRoute: MapRouteResponse | null;
  } | null>(null);
  const routeUpgradeRef = useRef<AbortController | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const speech = useTransientSpeechInput(query, setQuery);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
    routeUpgradeRef.current?.abort();
    routeUpgradeRef.current = null;
  }, []);

  useEffect(() => {
    if (!shouldWarmMapIntent(navigator)) return;
    const controller = new AbortController();
    void fetch(`/api/plans/generate?cityId=${encodeURIComponent(cityId)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => {
      // This only removes cold-start work from the primary action. Generation
      // remains fully functional if warmup is unavailable or interrupted.
    });
    return () => controller.abort();
  }, [cityId]);

  async function generate() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const inferred = inferNightContext(query);
      const inferredQuery = inferred.context;
      const queryFields = new Set(inferred.reasons.map((reason) => reason.field));
      const atmosphere = [
        ...(moodTouched ? [mood] : []),
        ...(paceTouched ? [pace] : []),
      ];
      const context: Partial<NightContext> = {
        ...(areaTouched || !inferredQuery.nightArea ? { nightArea: area } : {}),
        ...(daypartTouched || !queryFields.has("daypart") ? { daypart } : {}),
        ...(groupSizeTouched || !queryFields.has("groupSize") ? {
          partyType: groupSize === 1 ? "solo" as const : "friends" as const,
          groupSize,
        } : {}),
        ...(queryFields.has("stopCount") ? {} : { stopCount }),
        ...(budgetLimit ? {
          budget: Number(budgetLimit) <= 22 ? "value" as const : "standard" as const,
          budgetLimitPence: Math.round(Number(budgetLimit) * 100),
        } : {}),
        ...(zeroProof ? { zeroProof: true } : {}),
        ...(atmosphere.length ? { atmosphere } : {}),
        ...(stepFree ? { accessibility: ["step-free"] } : {}),
      };
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cityId, ...(query.trim() ? { query: query.trim() } : {}), context }),
      });
      const body = await readApiJson(response) as {
        stops?: GeneratedStop[];
        inferredContext?: NightContext;
        planningConfidence?: PlanningConfidence;
        budgetSummary?: PlanBudgetSummary;
        routeTotals?: PlanRouteTotals;
        endingRecommendations?: PlanEndingRecommendation[];
        error?: unknown;
      } | null;
      if (!response.ok || !body || !Array.isArray(body.stops) || !isPlanStopCount(body.stops.length) || !body.inferredContext || !body.planningConfidence || !body.budgetSummary || !body.routeTotals || body.endingRecommendations?.length !== 3) {
        throw new Error(responseError(body));
      }
      const generated = {
        stops: body.stops,
        context: body.inferredContext,
        confidence: body.planningConfidence,
        budget: body.budgetSummary,
        routeTotals: body.routeTotals,
        endings: body.endingRecommendations,
      } satisfies GeneratedMobilePlan;
      const stopIds = generated.stops.map((stop) => stop.venueId);
      setResult({
        confidence: generated.confidence,
        budget: generated.budget,
        routeTotalLabel: planRouteTotalsFallbackLabel(generated.routeTotals),
        endings: generated.endings,
        // The narrow body type above omits proof/operationKey/alternatives; the
        // runtime response carries them for the exact-Route transfer.
        mapRoute: body as unknown as MapRouteResponse,
      });
      routeUpgradeRef.current?.abort();
      const routeController = new AbortController();
      routeUpgradeRef.current = routeController;
      void resolvePlanRouteTotalLabel(stopIds, generated.routeTotals, venuesById, routeController.signal)
        .then((routeTotalLabel) => {
          if (routeController.signal.aborted) return;
          setResult((current) => (current ? { ...current, routeTotalLabel } : current));
        })
        .catch(() => {
          /* fail-soft: keep the straight-line label already shown */
        });
      if (!user) writeDeviceNightContext(generated.context, cityId);
      // First meaningful plan action (starting a round): arms the native push
      // explainer in Capacitor or the daily-brief explainer in an installed
      // PWA. Both remain no-ops in an ordinary web tab and during SSR.
      recordPlanHighIntentAction();
      // Keep the planner result responsive while the map derives and paints
      // the route layers. Route activation is non-urgent and remains ordered.
      startTransition(() => onGenerated(generated));
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "PUBMAXX could not build that route.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section className="mobilePlannerIntent" aria-labelledby="mobile-plan-intent-title">
      <div className="mobilePlannerIntentHeading">
        <Sparkles size={20} aria-hidden="true" />
        <div>
          <h3 id="mobile-plan-intent-title">Describe the outing</h3>
          <p>Choose three to six stops, all straight off the map.</p>
        </div>
      </div>
      <div className="mobilePlannerIntentInput">
        <label htmlFor="mobile-plan-query">Describe the outing</label>
        <div>
          <input id="mobile-plan-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quiet in Soho, four of us, under £25" maxLength={500} />
          {speech.supported ? <Button type="button" variant="ghost" size="icon" aria-label={speech.listening ? "Stop describing the outing" : "Describe the outing by voice"} aria-pressed={speech.listening} onClick={speech.toggle}>{speech.listening ? <MicOff size={18} /> : <Mic size={18} />}</Button> : null}
        </div>
        {speech.listening ? <small role="status">Listening. The transcript stays in this field only.</small> : null}
        {speech.error ? <small role="status">{speech.error}</small> : null}
      </div>
      <div className="mobilePlannerIntentGrid">
        <label>Area<select value={area} onChange={(event) => { setAreaTouched(true); setArea(event.target.value as NightAreaSlug); }}>{areas.map((nightArea) => <option key={nightArea.slug} value={nightArea.slug}>{nightArea.name}</option>)}</select></label>
        <label>Time<select value={daypart} onChange={(event) => { setDaypartTouched(true); setDaypart(event.target.value as NightContext["daypart"]); }}><option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option></select></label>
        <label>People<input type="number" min="1" max="30" value={groupSize} onChange={(event) => { setGroupSizeTouched(true); setGroupSize(Math.max(1, Math.min(30, Number(event.target.value) || 1))); }} /></label>
        <label>Stops<select value={stopCount} onChange={(event) => setStopCount(normalizePlanStopCount(Number(event.target.value)))}>{PLAN_STOP_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        <label>Max each<input type="number" inputMode="decimal" min="5" max="500" value={budgetLimit} onChange={(event) => setBudgetLimit(event.target.value)} placeholder="£" /></label>
      </div>
      <AreaNewsBlock
        area={area}
        areaLabel={areas.find((nightArea) => nightArea.slug === area)?.name ?? area}
      />
      <div className="mobilePlannerIntentChips" role="group" aria-label="Outing mood">
        {MOODS.map((value) => <Chip key={value} aria-pressed={moodTouched && mood === value} onClick={() => { setMoodTouched(true); setMood(value); }}>{value}</Chip>)}
      </div>
      <div className="mobilePlannerIntentChips" role="group" aria-label="Outing pace">
        {PACES.map((value) => <Chip key={value} aria-pressed={paceTouched && pace === value} onClick={() => { setPaceTouched(true); setPace(value); }}>{value.replace(" pace", "")}</Chip>)}
      </div>
      <div className="mobilePlannerIntentChips" role="group" aria-label="Route needs">
        <Chip aria-pressed={stepFree} onClick={() => setStepFree((current) => !current)}>Step-free</Chip>
        {/* "0.0 options" read as broken number formatting, not as a drink.
            The chip names the drink the way the rest of the app does. */}
        <Chip aria-pressed={zeroProof} onClick={() => setZeroProof((current) => !current)}>Alcohol-free</Chip>
      </div>
      <Button type="button" size="large" className="w-full" disabled={loading} aria-busy={loading} onClick={() => void generate()}>{loading ? <span className="mobilePlannerIntentPending"><PubmaxxLoadingEmber size={15} />Planning…</span> : "Make a plan"}</Button>
      {error ? <p className="mobilePlannerIntentError" role="alert">{error}</p> : null}
      {result ? (
        <div className="mobilePlannerResult" role="status">
          <div className="mobilePlannerConfidence" data-level={result.confidence.level}>
            <ShieldCheck size={17} aria-hidden="true" />
            <div><strong>{result.confidence.level === "high" ? "Prices checked" : result.confidence.level === "medium" ? "Not all checked" : "Rough guess, yours to change"}</strong><span>{result.budget.estimatedPerPersonPence === null ? "Some prices are missing. Check each stop before relying on the budget." : `Estimated £${(result.budget.estimatedPerPersonPence / 100).toFixed(2)} each for one recorded pint per stop.`}</span>{result.confidence.warnings.length ? <ul aria-label="Route warnings">{result.confidence.warnings.map((warning) => <li key={warning}><small>{warning}</small></li>)}</ul> : null}</div>
          </div>
          <p className="mobilePlannerRouteTotal">{result.routeTotalLabel}</p>
          <p className="mobilePlannerNextStep">Route preview stays on this device. Lock it in on Plan when you want a shareable crew link.</p>
          <MapRouteTransferButton response={result.mapRoute} mapRouteTransfer={mapRouteTransfer} />
          <div className="mobilePlannerEndings" aria-label="Ending recommendations">
            {result.endings.map((ending) => (
              <div key={ending.kind} data-recommended={ending.preselected ? "true" : undefined}>
                <span><strong>{ending.label}</strong>{ending.preselected ? <small>Recommended</small> : null}</span>
                <p>{ending.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
