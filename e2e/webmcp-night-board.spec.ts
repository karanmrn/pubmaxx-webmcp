import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

async function installWebMcpHarness(page: Page) {
  await page.addInitScript(() => {
    const tools: Record<string, { execute: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown> }> = {};
    Object.defineProperty(window, "__pubmaxxWebMcpTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: typeof tools[string]) {
          const named = tool as typeof tools[string] & { name: string };
          tools[named.name] = named;
          return Promise.resolve(undefined);
        },
      },
    });
  });
}

async function invokeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const tools = (window as typeof window & {
      __pubmaxxWebMcpTools: Record<string, {
        execute: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
      }>;
    }).__pubmaxxWebMcpTools;
    return tools[toolName].execute(toolInput, { signal: new AbortController().signal });
  }, { toolName: name, toolInput: input });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installWebMcpHarness(page);
  await page.route("**/api/venue-search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "ready",
      venues: [{ id: "venue-a", name: "The Falcon", area: "Clapham" }],
    }),
  }));
  await page.route("**/api/citymcp/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: "2026-09-03T18:00:00.000Z",
      weather: { condition: "Clear", tempC: 18 },
      tubeLines: [{ line: "Northern", status: "Minor delays" }],
      signals: [],
    }),
  }));
  await page.route("**/api/citymcp/things-to-do**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: "2026-09-03T18:00:00.000Z",
      opportunities: [{ title: "Late comedy", kind: "comedy", place: { name: "Clapham Grand" } }],
    }),
  }));
  await page.route("**/api/plans/generate", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      grounded: true,
      groundingProof: "test-proof",
      operationKey: "webmcp-e2e",
      inferredContext: {
        nightArea: "clapham",
        daypart: "evening",
        partyType: "friends",
        groupSize: 3,
        budget: "cheap",
        budgetLimitPence: null,
        zeroProof: false,
        wetherspoonsPreferred: false,
        atmosphere: ["lively"],
        foodNeeds: [],
        accessibility: [],
        transportConstraints: [],
        stopCount: 3,
      },
      stops: [
        { venueId: "venue-a", venueName: "The Falcon", reason: "Start near the station.", alternatives: [] },
        { venueId: "venue-b", venueName: "The Railway", reason: "Keep the walk short.", alternatives: [{ venueId: "venue-x", venueName: "The Belle Vue" }] },
        { venueId: "venue-c", venueName: "The Windmill", reason: "Finish near transport.", alternatives: [] },
      ],
      routeTotals: { stopCount: 3, straightLineWalkingKm: 1.1, estimatedWalkingMinutes: 18, distanceBasis: "straight-line" },
      planningConfidence: { level: "medium", score: 0.72, routeReady: true, missingEvidence: [], warnings: [], provenance: [{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" }] },
    }),
  }));
});

test("person and agent share evidence, route revisions, and safe swaps", async ({ page }) => {
  await page.goto("/webmcp");
  await expect(page.getByRole("status")).toContainText("Agent tools ready");

  await invokeTool(page, "search_pubmaxx_venues", { query: "Falcon", limit: 4 });
  await invokeTool(page, "read_london_night_context", {});
  await expect(page.getByText("The Falcon")).toBeVisible();
  await expect(page.getByText("Late comedy")).toBeVisible();

  await invokeTool(page, "draft_pub_crawl", {
    request: "Three cheap lively pubs in Clapham",
    expectedRevision: 0,
  });
  await expect(page.getByText("Revision 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Railway" })).toBeVisible();

  const swap = await invokeTool(page, "swap_crawl_stop", { position: 2, expectedRevision: 1 });
  expect(swap).toMatchObject({ status: "ok", revision: 2, routeStale: true });
  await expect(page.getByText("Revision 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Belle Vue" })).toBeVisible();
  await expect(page.getByText("Needs refresh")).toBeVisible();

  const fits = await page.locator(".webmcpShell").evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(fits).toBe(true);
  for (const button of await page.getByRole("button").all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
