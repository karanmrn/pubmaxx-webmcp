import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// DAG L10 — server-enforced Friend privacy boundary, proven end to end on the
// production build. An ANONYMOUS viewer (no member capability) of the /plan/[id]
// page HTML, the plan API, and the recap API only ever receives the privacy
// preview: never a venue id/name, the stop order, or the user-entered title.
// This must hold in BOTH flag states — with rehydration off (preview for
// everyone) and on (preview for everyone WITHOUT a capability).

const SECRET_TITLE = "Karan private stag blowout 12345";
const BASE_URL = `http://localhost:${process.env.PW_PORT ?? 3100}`;

test("anonymous plan surfaces never leak the route, venues, or title", async ({ request, playwright }) => {
  // Real venues so the created Plan has a genuine three-stop route to hide.
  const venues = ((await (await request.get("/data/venues_slim.json")).json() as { rows: Array<{ id: string; name: string }> }).rows).slice(0, 3);
  expect(venues.length).toBe(3);

  // The creating context holds the HttpOnly member cookie; we never read the
  // anonymous surfaces through it.
  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: SECRET_TITLE,
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: "Karan",
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id: string = (await created.json()).plan.plan.id;

  const forbidden = [SECRET_TITLE, ...venues.map((v) => v.name), ...venues.map((v) => v.id)];
  const assertClean = (body: string, where: string) => {
    for (const token of forbidden) {
      expect(body, `${where} must not contain "${token}"`).not.toContain(token);
    }
  };

  // A genuinely anonymous context — no member cookie, exactly like an uninvited
  // link recipient or a crawler.
  const anon = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    // 1. Anonymous page HTML: preview only, no route serialized into the RSC.
    const pageHtml = await (await anon.get(`/plan/${id}`)).text();
    assertClean(pageHtml, "page HTML");
    expect(pageHtml).not.toContain('"stops"');

    // 2. Anonymous plan API → preview projection.
    const apiBody = await (await anon.get(`/api/plans/${id}`)).text();
    assertClean(apiBody, "plan API");
    expect(apiBody).toContain('"visibility":"preview"');

    // 3. Anonymous recap API → preview projection, no venue/pint detail.
    const recapBody = await (await anon.get(`/api/plans/${id}/recap`)).text();
    assertClean(recapBody, "recap API");
    expect(recapBody).toContain('"visibility":"preview"');

    // 4. Anonymous get-in API → no venue/route detail leaks through the
    //    per-stop estimate surface (§4.10 boundary list).
    const getin = await anon.get(`/api/plans/${id}/getin`);
    assertClean(await getin.text(), "get-in API");

    // 5. OG card still renders (image); preview-safe by construction.
    const card = await anon.get(`/api/plan-card?id=${id}`);
    expect(card.ok()).toBe(true);
  } finally {
    await anon.dispose();
  }
});
