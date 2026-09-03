"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";

import WantedPlanChips from "@/components/wanted/WantedPlanChips";
import { CULTURE_CRAWL_CHIPS, CULTURE_CRAWL_MISSION } from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { inferNightContext } from "@/lib/nightPlanning";
import { resolveDescribeChipSubmit } from "@/lib/planComposerChipFill";
import { normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";

export { DESCRIBE_FIRST_CHIPS };

export default function PlanDescribeFirst({
  onSubmit,
  onGuideMeInstead,
  onQueryChange,
  onPrefillQueryChange,
  initialQuery = "",
}: {
  onSubmit: (query: string, stopCount?: PlanStopCount) => void;
  onGuideMeInstead: () => void;
  onQueryChange?: (query: string) => void;
  /** External handoffs only: URL or Ask prefills while the field stays untouched. */
  onPrefillQueryChange?: (query: string) => void;
  /** Prefill from a confirmed Night OS Ask draft_plan proposal. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery.slice(0, 500));
  const [stopCount, setStopCount] = useState<PlanStopCount>(normalizePlanStopCount(inferNightContext(initialQuery).context.stopCount));
  // The prefill arrives AFTER mount: the composer reads the URL in an effect,
  // so an `?occasion=` deep link would otherwise land on an empty field and
  // read as a broken destination. Adopt a later prefill only while the field is
  // untouched, never over something the visitor typed.
  const [touched, setTouched] = useState(false);
  const [stopCountTouched, setStopCountTouched] = useState(false);
  const appliedPrefill = useRef(initialQuery);
  const reportedPrefill = useRef<string | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  const onPrefillQueryChangeRef = useRef(onPrefillQueryChange);
  useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);
  useEffect(() => {
    onPrefillQueryChangeRef.current = onPrefillQueryChange;
  }, [onPrefillQueryChange]);
  useEffect(() => {
    const nextQuery = initialQuery.slice(0, 500);
    if (!nextQuery || reportedPrefill.current === nextQuery) return;
    reportedPrefill.current = nextQuery;
    onPrefillQueryChangeRef.current?.(nextQuery);
  }, [initialQuery]);
  useEffect(() => {
    if (touched || initialQuery === appliedPrefill.current) return;
    appliedPrefill.current = initialQuery;
    const nextQuery = initialQuery.slice(0, 500);
    const nextStopCount = normalizePlanStopCount(inferNightContext(initialQuery).context.stopCount);
    let cancelled = false;
    // Prefill is an external handoff. Defer its state adoption so React 19 does
    // not treat the effect as a synchronous render cascade.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setQuery(nextQuery);
      if (!stopCountTouched) setStopCount(nextStopCount);
      if (nextQuery && reportedPrefill.current !== nextQuery) {
        reportedPrefill.current = nextQuery;
        onPrefillQueryChangeRef.current?.(nextQuery);
      }
    });
    return () => { cancelled = true; };
  }, [initialQuery, stopCountTouched, touched]);

  function submit(queryOverride = query) {
    const trimmed = queryOverride.trim();
    if (!trimmed) return;
    onSubmit(trimmed, stopCount);
  }

  function submitChip(value: string) {
    const chipInferredStopCount = normalizePlanStopCount(inferNightContext(value).context.stopCount);
    const hadTypedQuery = Boolean(query.trim());
    const resolved = resolveDescribeChipSubmit({
      query,
      stopCountTouched,
      stopCount,
      chipText: value,
      chipInferredStopCount,
    });
    if (!stopCountTouched) setStopCount(resolved.stopCount);
    // Typed text wins: a chip may fill an empty field and submit, but it must
    // never wipe or auto-submit over a query the drinker already typed.
    if (hadTypedQuery) return;
    onSubmit(resolved.query, resolved.stopCount);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  return (
    <section className="planDescribeFirst" aria-labelledby="plan-describe-first-title">
      <h2 id="plan-describe-first-title">What&rsquo;s the plan?</h2>
      {/* Plain markup, not a form: this whole surface already sits inside
          PlanComposerForm's own <form>, and a nested <form> is invalid HTML
          that browsers silently reparent, breaking native submission. */}
      <div className="planDescribeFirst__form">
        <label className="planComposer__srOnly" htmlFor="plan-describe-first-query">Describe the outing</label>
        <input
          id="plan-describe-first-query"
          value={query}
          onChange={(event) => {
            setTouched(true);
            const value = event.target.value;
            setQuery(value);
            onQueryChange?.(value);
            if (!stopCountTouched) {
              setStopCount(normalizePlanStopCount(inferNightContext(value).context.stopCount));
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Quiet in Clapham for 4"
          maxLength={500}
        />
        <button
          type="button"
          onClick={() => query.trim() ? submit() : onGuideMeInstead()}
        >
          {query.trim() ? "Make a plan" : "Guide me"}
        </button>
      </div>
      <PlanStopCountPicker
        value={stopCount}
        onChange={(next) => {
          setStopCountTouched(true);
          setStopCount(next);
        }}
      />
      <WantedPlanChips onPick={submitChip} />
      <div className="planDescribeFirst__culture" role="group" aria-label="Culture Crawl">
        <p className="planDescribeFirst__cultureLead">{CULTURE_CRAWL_MISSION}</p>
        <div className="planDescribeFirst__cultureChips">
          {CULTURE_CRAWL_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="planDescribeFirst__chip planDescribeFirst__chip--culture"
              onClick={() => submitChip(chip.query)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="planDescribeFirst__chips" role="group" aria-label="Try an example">
        {DESCRIBE_FIRST_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="planDescribeFirst__chip"
            onClick={() => submitChip(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
      <button type="button" className="planDescribeFirst__guide" onClick={onGuideMeInstead}>
        Guide me instead
      </button>
    </section>
  );
}
