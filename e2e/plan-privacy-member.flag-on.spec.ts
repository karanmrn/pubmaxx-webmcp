import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// DAG L10 — the member side of the boundary. Renamed to *.flag-on so it runs
// only in the chromium-flag-on project against a server built with
// friendMemberRehydrationV2 ON (no runtime test.skip — L20 zero-skip contract).
// With the flag on, the plan creator's capability (the HttpOnly cookie set on
// create, path-scoped to /api/plans/[id]) unlocks the FULL PlanState from the
// same endpoint the page client upgrades through — proving the privacy split
// never broke members. The signed-out anonymous half is asserted in
// plan-privacy-boundary.spec.ts, which runs in the default flag-off suite.

test("a host with a valid capability sees the full route when the flag is on", async ({ request }) => {
  const venues = ((await (await request.get("/data/venues_slim.json")).json() as { rows: Array<{ id: string; name: string }> }).rows).slice(0, 3);
  expect(venues.length).toBe(3);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Members see the route",
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: "Host",
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id: string = (await created.json()).plan.plan.id;

  // Same request context keeps the HttpOnly member cookie from create, so this
  // GET carries the capability exactly like the page's client upgrade fetch.
  const body = await (await request.get(`/api/plans/${id}`)).text();
  const parsed = JSON.parse(body);
  // Member projection is the raw PlanState (no `visibility` discriminator).
  expect(parsed.visibility).toBeUndefined();
  expect(Array.isArray(parsed.stops)).toBe(true);
  expect(parsed.stops.length).toBe(3);
  expect(body).toContain(venues[0].name);
});
