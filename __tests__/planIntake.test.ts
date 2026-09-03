import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlanIntake from "@/components/plan/PlanIntake";

import {
  PLAN_INTAKE_DRAFT_TTL_MS,
  PLAN_INTAKE_STEPS,
  PLAN_INTAKE_STORAGE_KEY,
  buildPlanGenerationIntakeBody,
  canSeedPlanIntakeArea,
  clearPlanIntakeDraft,
  createPlanIntakeDraft,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  nextLondonOccurrenceIso,
  parsePlanIntakeDraft,
  planIntakeHandoff,
  planIntakeNightContextPatch,
  planIntakeStepHasAnswer,
  readPlanIntakeDraft,
  reopenPlanIntakeStep,
  resolveFutureLondonStartIso,
  resolvePlanIntakeAreaSeed,
  settlePlanIntakeStep,
  skipRemainingPlanIntake,
  writePlanIntakeDraft,
  type PlanIntakeDraft,
  type PlanIntakeStep,
} from "@/lib/planIntake";
import type { NightContext } from "@/lib/nightPlanning";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function answeredDraft(): PlanIntakeDraft {
  return {
    ...createPlanIntakeDraft(),
    currentStep: "accessibility",
    settledSteps: [...PLAN_INTAKE_STEPS],
    skippedSteps: [],
    completed: true,
    answers: {
      area: "london-bridge",
      timeWindow: "after-work",
      exactStartIso: "2026-07-20T16:30:00.000Z",
      groupSize: 5,
      budget: "value",
      budgetLimitPence: 2500,
      accessibilityNeeds: ["step-free", "accessible-toilet"],
    },
  };
}

function storedEnvelope(draft: PlanIntakeDraft, now = NOW): string {
  return JSON.stringify({
    storageVersion: 1,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_INTAKE_DRAFT_TTL_MS).toISOString(),
    draft,
  });
}

describe("progressive Plan intake", () => {
  it("starts with one area question and carries a remembered patch forward", () => {
    expect(createPlanIntakeDraft()).toMatchObject({
      currentStep: "area",
      settledSteps: [],
      completed: false,
      answers: { area: null, exactStartIso: null },
    });
    expect(createPlanIntakeDraft({ kind: "patch", id: "brixton" })).toMatchObject({
      currentStep: "time-window",
      settledSteps: ["area"],
      answers: { area: "brixton" },
    });
  });

  it("migrates only a legacy borough name that exactly matches a night patch", () => {
    expect(createPlanIntakeDraft({ kind: "borough", name: "Hackney" }).answers.area).toBe("hackney");
    expect(createPlanIntakeDraft({ kind: "borough", name: "City of Westminster" }).answers.area).toBeNull();
  });

  it("lets every step be skipped and clears every skipped answer", () => {
    let draft = createPlanIntakeDraft();
    for (const step of PLAN_INTAKE_STEPS) {
      expect(draft.currentStep).toBe(step);
      draft = settlePlanIntakeStep(draft, { skip: true });
    }
    expect(draft).toMatchObject({
      completed: true,
      settledSteps: PLAN_INTAKE_STEPS,
      skippedSteps: PLAN_INTAKE_STEPS,
      answers: {
        area: null,
        timeWindow: null,
        exactStartIso: null,
        groupSize: null,
        budget: null,
        budgetLimitPence: null,
        accessibilityNeeds: [],
      },
    });
  });

  it("refuses to settle an unanswered step unless it is explicitly skipped", () => {
    const draft = createPlanIntakeDraft();
    expect(settlePlanIntakeStep(draft)).toBe(draft);
    expect(settlePlanIntakeStep(draft, { skip: true })).not.toBe(draft);
  });

  it("keeps answered choices and skips only unanswered choices when switching to description", () => {
    const remembered = skipRemainingPlanIntake(createPlanIntakeDraft({ kind: "patch", id: "soho" }));
    expect(remembered.answers.area).toBe("soho");
    expect(remembered.skippedSteps).toEqual(PLAN_INTAKE_STEPS.slice(1));

    const selected = {
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "soho" as const },
    };
    const completed = skipRemainingPlanIntake(selected);
    expect(planIntakeStepHasAnswer(selected)).toBe(true);
    expect(completed.answers.area).toBe("soho");
    expect(completed.skippedSteps).not.toContain("area");
  });

  it("reopens one completed answer and resumes at that step", () => {
    const reopened = reopenPlanIntakeStep(answeredDraft(), "budget");
    expect(reopened).toMatchObject({ currentStep: "budget", completed: false });
    expect(reopened.settledSteps).not.toContain("budget");
    expect(settlePlanIntakeStep(reopened, { skip: true }).completed).toBe(true);
  });
});

describe("Plan intake area seed precedence", () => {
  it("prefers a live-position patch over a stale remembered patch", () => {
    expect(resolvePlanIntakeAreaSeed("shoreditch", { kind: "patch", id: "soho" }))
      .toEqual({ kind: "patch", id: "shoreditch" });
  });

  it("falls back to the remembered area when live position is unavailable", () => {
    expect(resolvePlanIntakeAreaSeed(null, { kind: "patch", id: "soho" }))
      .toEqual({ kind: "patch", id: "soho" });
  });

  it("only auto-seeds a blank intake draft", () => {
    expect(canSeedPlanIntakeArea(createPlanIntakeDraft())).toBe(true);
    expect(canSeedPlanIntakeArea(createPlanIntakeDraft({ kind: "patch", id: "soho" }))).toBe(false);
    expect(canSeedPlanIntakeArea(settlePlanIntakeStep(createPlanIntakeDraft(), { skip: true }))).toBe(false);
  });
});

describe("bounded Plan intake persistence", () => {
  it("round-trips a canonical partial flow in a bounded envelope", () => {
    const storage = memoryStorage();
    const draft = settlePlanIntakeStep({
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "clapham" },
    });
    writePlanIntakeDraft(draft, storage, NOW);
    const raw = storage.getItem(PLAN_INTAKE_STORAGE_KEY);
    expect(raw).toContain('"storageVersion":1');
    expect(raw).toContain('"expiresAt":"2026-07-21T12:00:00.000Z"');
    expect(readPlanIntakeDraft(storage, NOW)).toEqual(draft);
  });

  it("expires abandoned details and removes the stale storage entry", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(answeredDraft(), storage, NOW);
    expect(readPlanIntakeDraft(storage, NOW + PLAN_INTAKE_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
  });

  it("clears the full intake draft after successful Plan creation", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(answeredDraft(), storage, NOW);
    clearPlanIntakeDraft(storage);
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
  });
});

describe("strict draft canonicalization", () => {
  it("clears skipped answers and canonicalizes currentStep to the first unsettled step", () => {
    const draft: PlanIntakeDraft = {
      ...createPlanIntakeDraft(),
      currentStep: "accessibility",
      settledSteps: ["area"],
      skippedSteps: ["area"],
      answers: { ...createPlanIntakeDraft().answers, area: "soho" },
    };
    expect(parsePlanIntakeDraft(storedEnvelope(draft), NOW)).toMatchObject({
      currentStep: "time-window",
      completed: false,
      answers: { area: null },
    });
  });

  it("rejects settled unskipped steps without a valid answer", () => {
    const draft: PlanIntakeDraft = {
      ...createPlanIntakeDraft(),
      currentStep: "time-window",
      settledSteps: ["area"],
      answers: { ...createPlanIntakeDraft().answers, area: null },
    };
    expect(parsePlanIntakeDraft(storedEnvelope(draft), NOW)).toBeNull();
  });

  it("rejects duplicate or unknown step states", () => {
    const envelope = JSON.parse(storedEnvelope(createPlanIntakeDraft())) as {
      draft: Record<string, unknown>;
    };
    envelope.draft.settledSteps = ["area", "area"];
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
    envelope.draft.settledSteps = ["bogus"];
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
  });

  it("accepts completed only for a consistent terminal draft", () => {
    const partial = createPlanIntakeDraft();
    expect(parsePlanIntakeDraft(storedEnvelope({ ...partial, completed: true }), NOW)).toBeNull();
    expect(parsePlanIntakeDraft(storedEnvelope({ ...answeredDraft(), completed: false }), NOW)).toBeNull();
    expect(parsePlanIntakeDraft(storedEnvelope(answeredDraft()), NOW)?.completed).toBe(true);
  });

  it("rejects malformed envelopes and overlong retention windows", () => {
    expect(parsePlanIntakeDraft(JSON.stringify({ version: 1 }), NOW)).toBeNull();
    const envelope = JSON.parse(storedEnvelope(createPlanIntakeDraft())) as {
      expiresAt: string;
    };
    envelope.expiresAt = new Date(NOW + PLAN_INTAKE_DRAFT_TTL_MS + 1).toISOString();
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
  });
});

describe("Europe/London exact time", () => {
  it("uses the next future occurrence and rolls a passed late slot to tomorrow", () => {
    expect(nextLondonOccurrenceIso("late", new Date("2026-07-20T20:30:00.000Z")))
      .toBe("2026-07-20T21:00:00.000Z");
    expect(nextLondonOccurrenceIso("late", new Date("2026-07-20T21:30:00.000Z")))
      .toBe("2026-07-21T21:00:00.000Z");
  });

  it("uses the correct London offset across both DST transitions", () => {
    expect(nextLondonOccurrenceIso("after-work", new Date("2026-03-28T23:30:00.000Z")))
      .toBe("2026-03-29T16:30:00.000Z");
    expect(nextLondonOccurrenceIso("after-work", new Date("2026-10-24T23:30:00.000Z")))
      .toBe("2026-10-25T17:30:00.000Z");
  });

  it("rejects a spring DST gap and resolves the next ambiguous autumn occurrence", () => {
    expect(londonDateTimeInputToIso("2026-03-29T01:30")).toBeNull();
    expect(londonDateTimeInputToIso("2026-10-25T01:30", new Date("2026-10-25T00:45:00.000Z")))
      .toBe("2026-10-25T01:30:00.000Z");
    expect(londonDateTimeInputToIso("2026-10-25T01:30", new Date("2026-10-25T01:30:00.000Z")))
      .toBeNull();
    expect(londonDateTimeInputFromIso("2026-07-20T16:30:00.000Z")).toBe("2026-07-20T17:30");
  });

  it("revalidates a dated exact handoff as future without changing its occurrence", () => {
    expect(resolveFutureLondonStartIso(
      "2026-10-25T01:30",
      "2026-10-25T01:30:00.000Z",
      new Date("2026-10-25T01:29:59.000Z"),
    )).toBe("2026-10-25T01:30:00.000Z");
    expect(resolveFutureLondonStartIso(
      "2026-10-25T01:30",
      "2026-10-25T01:30:00.000Z",
      new Date("2026-10-25T01:30:00.000Z"),
    )).toBeNull();
  });
});

describe("Wave 2.2 typed handoff and stale constraint retraction", () => {
  const generatedContext: NightContext = {
    nightArea: "bermondsey-london-bridge",
    daypart: "after_work",
    partyType: "friends",
    groupSize: 5,
    budget: "value",
    budgetLimitPence: 2500,
    zeroProof: true,
    wetherspoonsPreferred: false,
    atmosphere: ["quiet"],
    foodNeeds: ["vegan"],
    accessibility: ["step-free", "accessible-toilet"],
    transportConstraints: ["tube"],
  };

  it("preserves exact dated time, ceiling and accessibility constraints", () => {
    const draft = answeredDraft();
    expect(planIntakeHandoff(draft)).toEqual({
      version: 1,
      area: { kind: "night-patch", id: "london-bridge" },
      timeWindow: {
        id: "after-work",
        start: "17:30",
        end: "20:30",
        exactStartIso: "2026-07-20T16:30:00.000Z",
      },
      groupSize: 5,
      budget: { tier: "value", limitPence: 2500 },
      accessibilityNeeds: ["step-free", "accessible-toilet"],
      skipped: [],
    });
    expect(planIntakeNightContextPatch(draft)).toEqual({
      nightArea: "bermondsey-london-bridge",
      daypart: "after_work",
      groupSize: 5,
      budget: "value",
      budgetLimitPence: 2500,
      accessibility: ["step-free", "accessible-toilet"],
    });
  });

  const ownedFields: Record<PlanIntakeStep, Array<keyof NightContext>> = {
    area: ["nightArea"],
    "time-window": ["daypart"],
    "group-size": ["groupSize"],
    budget: ["budget", "budgetLimitPence"],
    accessibility: ["accessibility"],
  };

  for (const step of PLAN_INTAKE_STEPS) {
    it(`removes stale ${step} fields after answer, generate, reopen and skip`, () => {
      const skipped = settlePlanIntakeStep(reopenPlanIntakeStep(answeredDraft(), step), { skip: true });
      const body = buildPlanGenerationIntakeBody(skipped, "", generatedContext);
      for (const field of ownedFields[step]) {
        expect(body.context).not.toHaveProperty(field);
      }
      expect(body.intake.skipped).toContain(step);
    });
  }

  it("preserves non-intake inferred context and explicit post-generation edits", () => {
    const skippedArea = settlePlanIntakeStep(
      reopenPlanIntakeStep(answeredDraft(), "area"),
      { skip: true },
    );
    const body = buildPlanGenerationIntakeBody(
      skippedArea,
      "",
      generatedContext,
      { nightArea: "victoria" },
    );
    expect(body.context).toMatchObject({
      nightArea: "victoria",
      partyType: "friends",
      zeroProof: true,
      wetherspoonsPreferred: false,
      atmosphere: ["quiet"],
      foodNeeds: ["vegan"],
      transportConstraints: ["tube"],
    });
  });

  it("threads an exact accepted Venue anchor through generation intake", () => {
    const anchor = {
      venueId: "venue-intent",
      source: "near" as const,
      cityId: "manchester" as const,
      acceptedArea: { kind: "night-patch" as const, id: "soho" as const },
      startsAt: "2026-07-24T20:00:00.000Z",
    };
    const body = buildPlanGenerationIntakeBody(
      answeredDraft(),
      "quiet pints",
      generatedContext,
      {},
      anchor,
    );

    expect(body.cityId).toBe("manchester");
    expect(body.anchor).toEqual({
      venueId: anchor.venueId,
      source: anchor.source,
      acceptedArea: anchor.acceptedArea,
      startsAt: anchor.startsAt,
    });
    expect(Object.keys(body.anchor ?? {})).toEqual([
      "venueId", "source", "acceptedArea", "startsAt",
    ]);
  });

  it("omits anchor from generic generation intake bodies", () => {
    const body = buildPlanGenerationIntakeBody(answeredDraft(), "", generatedContext);
    expect(body).not.toHaveProperty("anchor");
  });

  it("drops a seeded area from skipped so describe-first after Keep is consistent", () => {
    const seeded = createPlanIntakeDraft({ kind: "patch", id: "clapham" });
    const conflicting: PlanIntakeDraft = {
      ...seeded,
      skippedSteps: ["area", "time-window", "group-size", "budget", "accessibility"],
      settledSteps: [...PLAN_INTAKE_STEPS],
      completed: true,
    };
    const body = buildPlanGenerationIntakeBody(conflicting, "quiet in Clapham", null);
    expect(body.intake.area).toEqual({ kind: "night-patch", id: "clapham" });
    expect(body.intake.skipped).not.toContain("area");
  });

  it("does not silently coerce Hackney into a different generation area", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "hackney" });
    expect(planIntakeHandoff(draft).area).toEqual({ kind: "night-patch", id: "hackney" });
    expect(planIntakeNightContextPatch(draft)).not.toHaveProperty("nightArea");
  });
});

describe("intake accessibility and entry invariants", () => {
  it("renders standalone entry controls without a router provider", () => {
    const html = renderToStaticMarkup(createElement(PlanIntake, {
      draft: createPlanIntakeDraft(),
      onChange: () => undefined,
    }));
    expect(html).toContain("Shape the route");
    expect(html).toContain("Describe instead");
    expect(html).toContain('href="/pal/chat"');
  });
});
