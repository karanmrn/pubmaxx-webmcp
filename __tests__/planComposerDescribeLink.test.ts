// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the describe prefill owes is a VALUE IN A FIELD, not a line order, so
// this file mounts the composer and reads the input. The rule it pins has three
// halves that a source read cannot see: the URL beats a held ask draft, the
// draft is SPENT either way (it is one-shot, and a URL visit used to leave it
// behind for the next /plan to open on somebody's earlier ask), and the URL
// prefill survives a `sessionStorage` that THROWS - which it does outright when
// site data is blocked or the document is a sandboxed frame.

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }),
}));

// Siblings of the field under test, each with its own coverage. The describe
// surface itself stays real: it is what adopts the prefill.
vi.mock("@/components/plan/PlanIntake", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer from "@/components/plan/PlanComposer";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import {
  createPlanIntakeDraft,
  readPlanIntakeDraft,
  skipRemainingPlanIntake,
  writePlanIntakeDraft,
} from "@/lib/planIntake";
import { writePlanDraftEnvelope } from "@/lib/planDraft";

const URL_ASK = "Plan a crawl in Soho for 4";
const DRAFT_ASK = "an older ask nobody asked for again";

let root: Root | null = null;
let host: HTMLElement | null = null;

const realSessionStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;

const realLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage")!;

/**
 * Site data blocked, the way a browser really does it: `window.sessionStorage`
 * and `window.localStorage` are PROPERTY GETTERS, and a blocked browser raises
 * on the read itself rather than on a later method call. So the fake replaces
 * the getter, which is strictly stronger - naming the identifier anywhere is
 * enough to throw. `vi.spyOn` cannot express even the weaker form: jsdom's
 * Storage is a proxy, the spy silently never installs, and the assertion is
 * then vacuous.
 */
function blockStorage(): void {
  const refuse = (): never => {
    throw new DOMException("site data is blocked", "SecurityError");
  };
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: refuse });
  Object.defineProperty(window, "localStorage", { configurable: true, get: refuse });
}

function restoreStorage(): void {
  Object.defineProperty(window, "sessionStorage", realSessionStorage);
  Object.defineProperty(window, "localStorage", realLocalStorage);
}

function setSearch(search: string): void {
  window.history.replaceState({}, "", `/plan${search}`);
}

const realLocation = Object.getOwnPropertyDescriptor(window, "location")!;

/**
 * A client-side navigation commits its address AFTER React has begun the
 * render for the route it lands on, so a render-phase read still answers the
 * route the drinker came from. This double is exactly that ordering: the FIRST
 * `location.search` read answers the previous route, every read after it the
 * new one. `/pal/chat`'s Open in Plan is that navigation, so the ask it hands
 * over is the one this file's whole rule is about.
 */
function stageClientNavigation(previousSearch: string, nextSearch: string): void {
  setSearch(nextSearch);
  const live = window.location;
  let servedPrevious = false;
  const staged = new Proxy(live, {
    get(target, prop, receiver) {
      if (prop === "search" && !servedPrevious) {
        servedPrevious = true;
        return previousSearch;
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(window, "location", { configurable: true, get: () => staged });
}

function restoreLocation(): void {
  Object.defineProperty(window, "location", realLocation);
}

function typeInto(selector: string, value: string): void {
  const field = document.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`${selector} did not render`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickButton(label: string): void {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button reading ${label}`);
  button.click();
}

const HELD_ACCEPTANCE = {
  venueId: "venue-held",
  source: "pal" as const,
  cityId: "london" as const,
  acceptedArea: null,
  startsAt: null,
};

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settleComposerEffects();
}

/** Prefill and Pal auto-generate both schedule microtasks off effects. */
async function settleComposerEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function describeFieldValue(): string {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query");
  if (!field) throw new Error("describe-first field did not render");
  return field.value;
}

/** A Pub Pal `?query=` handoff may prefill describe-first or land in concierge after auto-generate. */
function landedUrlAskValue(): string {
  const describe = document.querySelector<HTMLInputElement>("#plan-describe-first-query");
  if (describe) return describe.value;
  const concierge = document.querySelector<HTMLInputElement>("#plan-concierge-query");
  if (concierge) return concierge.value;
  throw new Error("URL ask did not land in describe-first or concierge field");
}

function conciergeFieldValue(): string {
  const field = document.querySelector<HTMLInputElement>("#plan-concierge-query");
  if (!field) throw new Error("concierge field did not render");
  return field.value;
}

const DEFAULT_GENERATE_BODY = {
  grounded: true,
  groundingProof: "test-proof",
  stops: [
    { venueId: "venue-a", venueName: "Pub A" },
    { venueId: "venue-b", venueName: "Pub B" },
    { venueId: "venue-c", venueName: "Pub C" },
  ],
  inferredContext: { nightArea: "clapham", daypart: "evening", groupSize: 4 },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/plans/generate")) {
      return new Response(JSON.stringify(DEFAULT_GENERATE_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  sessionStorage.clear();
  localStorage.clear();
  setSearch("");
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  restoreLocation();
  restoreStorage();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("PlanComposer describe prefill", () => {
  it("prefers the URL ask over a held draft, and spends the draft anyway", async () => {
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: DRAFT_ASK }),
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(landedUrlAskValue()).toBe(URL_ASK);
    // One-shot: the next /plan visit must not reopen on this ask.
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("falls back to the held draft when the URL carries no ask, and spends it", async () => {
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: DRAFT_ASK }),
    );

    await mountComposer();

    expect(describeFieldValue()).toBe(DRAFT_ASK);
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not replace a recovered concierge line when a session ask prefill lands in describe-first", async () => {
    writePlanDraftEnvelope(
      {
        title: "Friday plan",
        creatorName: "Karan",
        startTime: "2026-08-28T18:00:00.000Z",
        conciergeQuery: DRAFT_ASK,
        stops: [
          { key: 1, venueId: "venue-a", venueName: "Pub A" },
          { key: 2, venueId: "venue-b", venueName: "Pub B" },
          { key: 3, venueId: "venue-c", venueName: "Pub C" },
        ],
      },
      "manual",
      sessionStorage,
    );
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: "session-only ask" }),
    );

    await mountComposer();
    await settleComposerEffects();

    expect(describeFieldValue()).toBe("session-only ask");
    expect(conciergeFieldValue()).toBe(DRAFT_ASK);
  });

  it("still lands the URL ask when the browser refuses site data", async () => {
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);
    blockStorage();

    await mountComposer();

    // The composer has to survive whole, not just the prefill effect: a persist
    // effect that names a blocked storage throws during the same flush and
    // React unmounts the tree, which reads as a blank /plan. This mounts the
    // composer alone - the page's own AuthProvider is mocked out here, and the
    // nudge it renders on every page carries its own blocked-storage coverage
    // in __tests__/identityNudge.test.ts.
    expect(landedUrlAskValue()).toBe(URL_ASK);
  });

  it("leaves the field empty when there is neither an ask nor a draft", async () => {
    await mountComposer();

    expect(describeFieldValue()).toBe("");
  });

  it("does not generate when describe-first asks for an unsupported night patch", async () => {
    await mountComposer();

    await act(async () => {
      typeInto("#plan-describe-first-query", "Hackney crawl tonight");
      clickButton("Make a plan");
      await Promise.resolve();
      await Promise.resolve();
    });

    const generateCalls = vi.mocked(fetch).mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      return url.includes("/api/plans/generate");
    });
    expect(generateCalls).toHaveLength(0);
  });
});

// A URL ask is a fresher intention than anything the browser held, and the two
// states below are the ones that used to hide the only surface showing it - so
// the CTA landed on /plan with the ask nowhere on screen and nothing said.
describe("PlanComposer never drops a URL ask", () => {
  it("does not start geolocation after typed describe text enters the wizard", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    await mountComposer();
    await act(async () => {
      typeInto("#plan-describe-first-query", "Camden");
      clickButton("Guide me instead");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(readPlanIntakeDraft(localStorage)).toBeNull();
  });

  it("keeps the full describe-first ask in the composer while typing", async () => {
    writePlanDraftEnvelope(
      {
        title: "Friday plan",
        creatorName: "Karan",
        startTime: "2026-08-28T18:00:00.000Z",
        conciergeQuery: "",
        stops: [
          { key: 1, venueId: "venue-a", venueName: "Pub A" },
          { key: 2, venueId: "venue-b", venueName: "Pub B" },
          { key: 3, venueId: "venue-c", venueName: "Pub C" },
        ],
      },
      "manual",
      sessionStorage,
    );

    await mountComposer();
    await act(async () => {
      typeInto("#plan-describe-first-query", "Camden crawl");
    });

    expect(conciergeFieldValue()).toBe("Camden crawl");
  });

  it("uses submitted concierge text as area authority for the main composer button", async () => {
    writePlanIntakeDraft(skipRemainingPlanIntake(createPlanIntakeDraft({ kind: "patch", id: "clapham" })));
    writePlanDraftEnvelope(
      {
        title: "Friday plan",
        creatorName: "Karan",
        startTime: "2026-08-28T18:00:00.000Z",
        conciergeQuery: "Camden crawl tonight",
        stops: [
          { key: 1, venueId: "venue-a", venueName: "Pub A" },
          { key: 2, venueId: "venue-b", venueName: "Pub B" },
          { key: 3, venueId: "venue-c", venueName: "Pub C" },
        ],
      },
      "manual",
      sessionStorage,
    );

    await mountComposer();

    const concierge = document.querySelector<HTMLInputElement>("#plan-concierge-query");
    if (!concierge) throw new Error("concierge query did not render");
    const button = concierge.parentElement?.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error("concierge submit did not render");

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    const generateCalls = vi.mocked(fetch).mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      return url.includes("/api/plans/generate");
    });
    expect(generateCalls).toHaveLength(1);
    const body = JSON.parse(String((generateCalls[0]?.[1] as RequestInit).body)) as {
      intake?: { area?: { id?: string } | null };
    };
    expect(body.intake?.area?.id).toBe("camden");
  });

  it("opens describe-first over an unfinished wizard draft", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "soho" }));
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(landedUrlAskValue()).toBe(URL_ASK);
  });

  it("leaves an unfinished wizard draft alone for a chip link", async () => {
    // Only the Pub Pal handoff overrides the wizard. `?occasion=` is a shipped
    // chip link, and CLAUDE.md's rule for those is unqualified: a saved,
    // incomplete wizard draft lands the visitor back on the wizard.
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "soho" }));
    setSearch("?occasion=coffee");

    await mountComposer();

    expect(document.querySelector("#plan-describe-first-query")).toBeNull();
  });

  it("still opens on the wizard when no ask rides the URL", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "soho" }));

    await mountComposer();

    expect(
      document.querySelector("#plan-describe-first-query"),
      "an unfinished wizard draft still wins on its own",
    ).toBeNull();
  });

  it("lands the ask in the composer's own field when a held pub opens it", async () => {
    // A held acceptance opens the full composer, so describe-first never renders.
    writePlanDraftEnvelope(
      {
        title: "",
        creatorName: "",
        startTime: "",
        conciergeQuery: "",
        stops: [{ key: 1, venueId: "venue-held", venueName: "The Held Arms" }],
        acceptedAnchor: {
          venueId: "venue-held",
          source: "pal",
          cityId: "london",
          acceptedArea: null,
          startsAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
      "planning-intent",
      sessionStorage,
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(document.querySelector("#plan-describe-first-query")).toBeNull();
    expect(conciergeFieldValue()).toBe(URL_ASK);
  });

  it("wins over a concierge line the recovered draft was holding", async () => {
    writePlanDraftEnvelope(
      {
        title: "",
        creatorName: "",
        startTime: "",
        conciergeQuery: DRAFT_ASK,
        stops: [{ key: 1, venueId: "venue-held", venueName: "The Held Arms" }],
        acceptedAnchor: {
          venueId: "venue-held",
          source: "pal",
          cityId: "london",
          acceptedArea: null,
          startsAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
      "planning-intent",
      sessionStorage,
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    // The drinker chose this ask a moment ago; the draft line is what they
    // left behind on an earlier visit.
    expect(conciergeFieldValue()).toBe(URL_ASK);
  });

  it("keeps the recovered concierge line when no ask rides the URL", async () => {
    writePlanDraftEnvelope(
      {
        title: "",
        creatorName: "",
        startTime: "",
        conciergeQuery: DRAFT_ASK,
        stops: [{ key: 1, venueId: "venue-held", venueName: "The Held Arms" }],
        acceptedAnchor: {
          venueId: "venue-held",
          source: "pal",
          cityId: "london",
          acceptedArea: null,
          startsAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
      "planning-intent",
      sessionStorage,
    );

    await mountComposer();

    expect(conciergeFieldValue()).toBe(DRAFT_ASK);
  });

  it("beats a held draft on a client navigation, where the mount render saw the old route", async () => {
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: DRAFT_ASK }),
    );
    stageClientNavigation("", `?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(describeFieldValue()).toBe(URL_ASK);
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not come back over a concierge line typed after the held pub is released", async () => {
    // A completed wizard draft keeps the full composer open after the release,
    // so the surface holding the ask never changes - only what the drinker has
    // typed into it since.
    writePlanIntakeDraft(skipRemainingPlanIntake(createPlanIntakeDraft()));
    writePlanDraftEnvelope(
      {
        title: "",
        creatorName: "",
        startTime: "",
        conciergeQuery: "",
        stops: [{ key: 1, venueId: "venue-held", venueName: "The Held Arms" }],
        acceptedAnchor: {
          ...HELD_ACCEPTANCE,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
      "planning-intent",
      sessionStorage,
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();
    expect(conciergeFieldValue()).toBe(URL_ASK);

    const typed = "Something else entirely, in Peckham";
    await act(async () => { typeInto("#plan-concierge-query", typed); });
    await act(async () => { clickButton("Release this pub"); });

    expect(conciergeFieldValue()).toBe(typed);
  });
});

// The server knows no address, so anything the composer reads off
// `window.location` during the HYDRATION render paints a field the server left
// empty - and React reconciles that as a mismatch. The URL ask therefore waits
// for the remount that follows hydration.
describe("PlanComposer hydration", () => {
  // An ask naming its own crawl size, so the stop-count picker's `aria-pressed`
  // really differs between the server's default and anything read off the URL.
  // An ask that infers the default 3 would make this assertion vacuous.
  const SIZED_ASK = "A five stop crawl in Soho";

  it("hydrates a /plan?query= document without a mismatch", async () => {
    // The real server has no `window`, so the helper answers null there
    // whatever the address is - which is what an empty search models here.
    // Rendering the server HTML with the address in place would make both
    // sides read it and leave nothing for this test to catch.
    setSearch("");
    const serverHtml = renderToString(createElement(PlanComposer));
    setSearch(`?query=${encodeURIComponent(SIZED_ASK)}`);

    host = document.createElement("div");
    host.innerHTML = serverHtml;
    document.body.append(host);

    const complaints: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      complaints.push(args.map((arg) => String(arg)).join(" "));
    });

    await act(async () => {
      root = hydrateRoot(host!, createElement(PlanComposer));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      complaints.filter((line) => /hydrat|did not match|mismatch/i.test(line)),
      "hydrating the composer should not reconcile against a different tree",
    ).toEqual([]);
    await settleComposerEffects();
    // The ask still lands, on the remount that follows hydration (or concierge after auto-generate).
    expect(landedUrlAskValue()).toBe(SIZED_ASK);
  });
});

describe("Pal handoff auto-generates once on /plan?query=", () => {
  it("POSTs generate on mount for a Pub Pal query handoff", async () => {
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);
    await mountComposer();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = vi.mocked(fetch);
    const generateCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/plans/generate");
    });
    expect(generateCall).toBeTruthy();
    expect(document.body.textContent).toContain("Route refreshed");
  });

  it("does not auto-generate for occasion chip links", async () => {
    setSearch("?occasion=quiet");
    await mountComposer();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = vi.mocked(fetch);
    const generateCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/plans/generate");
    });
    expect(generateCall).toBeUndefined();
  });

  it("auto-generates when a durable wizard draft holds an unsupported patch", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "hackney" }));
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);
    await mountComposer();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = vi.mocked(fetch);
    const generateCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/plans/generate");
    });
    expect(generateCall).toBeTruthy();
    expect(document.body.textContent).toContain("Route refreshed");
  });
});
