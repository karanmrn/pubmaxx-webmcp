import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertCompleteUiUxAudit } from "../scripts/lib/uiUxBattleTestCompletion.mjs";
import {
  AUDITED_FLOWS,
  configureAuditedFlowsForRunMode,
} from "../scripts/lib/uiUxBattleTestNavigation.mjs";

const completionInput = {
  originNames: ["local"],
  viewportNames: ["mobile-390", "desktop-1440"],
  routeNames: ["home", "map"],
  clsBudget: 0.1,
  motionPolicy: { local: "no-preference" },
  flowDefinitions: [
    { name: "near-answer" },
    { name: "map-pan-zoom", desktopOnly: true },
  ],
  pages: [
    { origin: "local", viewport: "mobile-390", routeName: "home", cls: 0, reducedMotion: false },
    { origin: "local", viewport: "mobile-390", routeName: "map", cls: 0.01, reducedMotion: false },
    { origin: "local", viewport: "desktop-1440", routeName: "home", cls: 0, reducedMotion: false },
    { origin: "local", viewport: "desktop-1440", routeName: "map", cls: 0.02, reducedMotion: false },
  ],
  flowResults: [
    { name: "near-answer", origin: "local", viewport: "mobile-390", status: "passed" },
    {
      name: "map-pan-zoom",
      origin: "local",
      viewport: "mobile-390",
      status: "not-applicable",
    },
    { name: "near-answer", origin: "local", viewport: "desktop-1440", status: "passed" },
    { name: "map-pan-zoom", origin: "local", viewport: "desktop-1440", status: "passed" },
  ],
};

describe("UI UX audit completion", () => {
  it("writes raw diagnostics before enforcing completion", () => {
    const source = readFileSync("scripts/ui-ux-battle-test.mjs", "utf8");
    const writeIndex = source.indexOf('await fs.writeFile(\n  path.join(outputRoot, "audit.json")');
    const assertionIndex = source.indexOf("assertCompleteUiUxAudit({");

    expect(writeIndex).toBeGreaterThan(-1);
    expect(assertionIndex).toBeGreaterThan(writeIndex);
  });

  it("accepts a complete page and flow matrix", () => {
    expect(() => assertCompleteUiUxAudit(completionInput)).not.toThrow();
  });

  it("rejects missing pages, CLS records, and failed applicable flows", () => {
    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: completionInput.pages.filter(({ routeName, viewport }) =>
        routeName !== "map" || viewport !== "desktop-1440",
      ),
    })).toThrow("Missing page record: local/desktop-1440/map");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: completionInput.pages.map((page) =>
        page.routeName === "map" && page.viewport === "mobile-390"
          ? { ...page, cls: undefined }
          : page,
      ),
    })).toThrow("Missing CLS record: local/mobile-390/map");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      flowResults: completionInput.flowResults.map((flow) =>
        flow.name === "map-pan-zoom" && flow.viewport === "desktop-1440"
          ? { ...flow, status: "failed", error: "Map did not move" }
          : flow,
      ),
    })).toThrow("Failed applicable flow: local/desktop-1440/map-pan-zoom");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: [
        ...completionInput.pages,
        { origin: "local", viewport: "desktop-1440", routeName: "extra", cls: 0 },
      ],
    })).toThrow("Unexpected page record: local/desktop-1440/extra");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      flowResults: [
        ...completionInput.flowResults,
        {
          name: "extra-flow",
          origin: "local",
          viewport: "desktop-1440",
          status: "passed",
        },
      ],
    })).toThrow("Unexpected flow record: local/desktop-1440/extra-flow");
  });

  it("requires CLS and motion policy metadata for every page", () => {
    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      clsBudget: undefined,
    })).toThrow("Missing CLS budget");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      motionPolicy: {},
    })).toThrow("Missing motion policy: local");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: completionInput.pages.map((page) =>
        page.routeName === "home" && page.viewport === "mobile-390"
          ? { ...page, reducedMotion: undefined }
          : page,
      ),
    })).toThrow("Missing reduced-motion record: local/mobile-390/home");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      motionPolicy: { local: "reduce" },
    })).toThrow("Reduced-motion policy mismatch: local/mobile-390/home");
  });

  it("accepts only declared unavailable reasons for an applicable flow", () => {
    const input = {
      originNames: ["local"],
      viewportNames: ["desktop-1440"],
      routeNames: ["home"],
      flowDefinitions: [{
        name: "login-sheet-open",
        desktopOnly: true,
        allowedNotApplicableResults: [{
          reason: "sign-in-trigger-unavailable",
          authConfigured: false,
        }],
      }],
      clsBudget: 0.1,
      motionPolicy: { local: "no-preference" },
      pages: [{
        origin: "local",
        viewport: "desktop-1440",
        routeName: "home",
        cls: 0,
        reducedMotion: false,
      }],
      flowResults: [{
        name: "login-sheet-open",
        origin: "local",
        viewport: "desktop-1440",
        status: "not-applicable",
        reason: "sign-in-trigger-unavailable",
        authConfigured: false,
      }],
    };

    expect(() => assertCompleteUiUxAudit(input)).not.toThrow();
    expect(() => assertCompleteUiUxAudit({
      ...input,
      flowResults: [{ ...input.flowResults[0], authConfigured: true }],
    })).toThrow("Failed applicable flow: local/desktop-1440/login-sheet-open");

    const configuredFlows = configureAuditedFlowsForRunMode(AUDITED_FLOWS, {
      frozenLiveBaseline: true,
    });
    const loginFlow = configuredFlows.find(({ name }) => name === "login-sheet-open");
    const liveInput = {
      ...input,
      originNames: ["live"],
      motionPolicy: { live: "reduce" },
      flowDefinitions: [loginFlow],
      pages: [{
        ...input.pages[0],
        origin: "live",
        reducedMotion: true,
      }],
      flowResults: [{
        ...input.flowResults[0],
        origin: "live",
        reason: "frozen-live-autofocus-unavailable",
        authConfigured: undefined,
        frozenLiveBaseline: true,
      }],
    };

    expect(() => assertCompleteUiUxAudit(liveInput)).not.toThrow();
    expect(() => assertCompleteUiUxAudit({
      ...liveInput,
      flowDefinitions: configureAuditedFlowsForRunMode(AUDITED_FLOWS),
    })).toThrow("Failed applicable flow: live/desktop-1440/login-sheet-open");
    expect(() => assertCompleteUiUxAudit({
      ...liveInput,
      flowResults: [{ ...liveInput.flowResults[0], frozenLiveBaseline: false }],
    })).toThrow("Failed applicable flow: live/desktop-1440/login-sheet-open");
  });
});
