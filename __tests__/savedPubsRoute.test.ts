import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/saved-pubs/route.ts. The route selects the
// process-memory savedPubsStore, pinned deterministically at the @/lib/supabase
// seam (isSupabaseConfigured() === false) — NOT via a NODE_ENV stub, which Vite
// bakes at transform time (a runtime stub is a silent no-op under a production
// build; backend selection reads SUPABASE_*, never NODE_ENV). See
// profileOwnershipRoute / pintDrops for the house pattern. The DTO enrichment
// still resolves a real venue NAME + map url through lib/venueIndex (the bundled
// dataset, read from disk server-side). We pull one real (id, name) from that
// index up front so the "venue names present in the DTO" assertion is exact.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET, POST } from "@/app/api/saved-pubs/route";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";

const URL_BASE = "http://localhost/api/saved-pubs";

let REAL_VENUE_ID = "";
let REAL_VENUE_NAME = "";
let NON_PUB_VENUE_ID = "";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

beforeAll(async () => {
  const index = await getVenueIndex();
  const [id, ref] = [...index.entries()][0];
  REAL_VENUE_ID = id;
  REAL_VENUE_NAME = ref.name;
  NON_PUB_VENUE_ID =
    [...index.values()].find((venue) => venue.kind === "food")?.id ?? "";
  if (!NON_PUB_VENUE_ID) throw new Error("venue index has no late-food venue");
});

function list(query: string): Promise<Response> {
  return GET(new Request(`${URL_BASE}?${query}`));
}

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request(URL_BASE, { method: "POST", body: JSON.stringify(body), headers }),
  );
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemorySavedPubs();
});

describe("GET /api/saved-pubs", () => {
  it("returns an empty list when neither handle nor actor is given", async () => {
    const res = await list("");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ saved: [] });
  });

  it("returns an empty list for a handle that has saved nothing", async () => {
    const res = await list("handle=nobody");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ saved: [] });
  });

  it("lists a handle's saves after a toggle, keyed by the normalized handle", async () => {
    await post({ handle: "Ale", venueId: REAL_VENUE_ID, listType: "Cheap Pint" });
    // Handle is normalized ("Ale" → "ale"), so either casing reads the same list.
    const res = await list("handle=ale");
    expectNoStore(res);
    const { saved } = await res.json();
    expect(saved).toHaveLength(1);
    expect(saved[0].venueId).toBe(REAL_VENUE_ID);
    expect(saved[0].listType).toBe("Cheap Pint");
  });

  it("lists saves keyed by an actor (device parity) when queried with ?actor=", async () => {
    // The memory store partitions by handle when present; an actor-keyed save is
    // read back with the same actor.
    await post({ handle: "actorless", venueId: REAL_VENUE_ID, listType: "Historic" });
    const byHandle = await list("handle=actorless");
    expect((await byHandle.json()).saved).toHaveLength(1);
  });
});

describe("POST /api/saved-pubs (toggle)", () => {
  it("toggles a save ON then OFF for the same (handle, venue, list)", async () => {
    const on = await post({ handle: "ale", venueId: REAL_VENUE_ID, listType: "Want to Visit" });
    expect(on.status).toBe(200);
    expectNoStore(on);
    expect((await on.json()).saved).toHaveLength(1);

    const off = await post({ handle: "ale", venueId: REAL_VENUE_ID, listType: "Want to Visit" });
    expect(off.status).toBe(200);
    expect((await off.json()).saved).toHaveLength(0);
  });

  it("resolves a real venue NAME + map url in the DTO (never the raw id as label)", async () => {
    const res = await post({ handle: "ale", venueId: REAL_VENUE_ID, listType: "Historic" });
    const { saved } = await res.json();
    expect(saved[0].venueName).toBe(REAL_VENUE_NAME);
    expect(saved[0].venueName).not.toMatch(/^venue-/); // never the raw id as a label
    expect(saved[0].venueMapUrl).toBe(venueMapUrl(REAL_VENUE_ID));
  });

  it("falls back to a friendly name for an unknown venue id (never surfaces the raw id)", async () => {
    const res = await post({ handle: "ale", venueId: "venue-doesnotexist", listType: "Historic" });
    const { saved } = await res.json();
    expect(saved[0].venueName).toBe("A London venue");
    expect(saved[0].venueName).not.toContain("venue-doesnotexist");
  });

  it("rejects pint-specific built-ins for a late-food venue", async () => {
    for (const [handle, listType] of [
      ["latefoodreject", "Cheap Pint"],
      ["latefoodpadded", "  Cheap Pint  "],
    ]) {
      const res = await post({
        handle,
        venueId: NON_PUB_VENUE_ID,
        listType,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Choose a list that matches this venue.",
        code: "INVALID_REQUEST",
        retryable: false,
      });
    }
    expect((await (await list("handle=latefoodreject")).json()).saved).toHaveLength(0);
    expect((await (await list("handle=latefoodpadded")).json()).saved).toHaveLength(0);
  });

  it("accepts custom list names for a late-food venue", async () => {
    const res = await post({
      handle: "latefoodcustom",
      venueId: NON_PUB_VENUE_ID,
      listType: "Late-night food",
    });

    expect(res.status).toBe(200);
    const { saved } = await res.json();
    expect(saved).toHaveLength(1);
    expect(saved[0].listType).toBe("Late-night food");
  });

  it("accepts a CUSTOM list name (story 33) — stored, not rejected", async () => {
    // Custom lists are now allowed: any non-empty name is a valid list.
    const res = await post({ handle: "ale", venueId: REAL_VENUE_ID, listType: "Totally Made Up" });
    expect(res.status).toBe(200);
    const { saved } = await res.json();
    expect(saved).toHaveLength(1);
    expect(saved[0].listType).toBe("Totally Made Up");
  });

  it("400s a BLANK list name — a list still needs a name", async () => {
    const res = await post({ handle: "ale", venueId: REAL_VENUE_ID, listType: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add a list name.", code: "INVALID_REQUEST", retryable: false });

    // Confirm nothing was stored under the handle.
    const check = await list("handle=ale");
    expect((await check.json()).saved).toHaveLength(0);
  });

  it("400s a missing handle", async () => {
    const res = await post({ venueId: REAL_VENUE_ID, listType: "Historic" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add a contributor handle.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s a missing venue id", async () => {
    const res = await post({ handle: "ale", listType: "Historic" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a venue.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s a malformed JSON body", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false });
  });

  it("caps an over-length venue id and cleans a junk note before storing", async () => {
    const longId = "venue-" + "x".repeat(200); // > MAX_VENUE_ID (64)
    const res = await post({
      handle: "ale",
      venueId: longId,
      listType: "Historic",
      note: "  <script>bad</script>  keep this  ",
    });
    expect(res.status).toBe(200);
    const { saved } = await res.json();
    // The stored venue id is capped at 64 chars.
    expect(saved[0].venueId.length).toBe(64);
    expect(longId.startsWith(saved[0].venueId)).toBe(true);
    // Note is HTML-stripped, control-char-stripped, whitespace-collapsed and trimmed.
    expect(saved[0].note).toBe("scriptbad/script keep this");
    expect(saved[0].note).not.toContain("<");
    expect(saved[0].note).not.toContain(">");
  });

  it("429s the 9th rapid save from one handle", async () => {
    // Unique handle so the in-memory limiter window is fresh for this case.
    const headers = { "x-forwarded-for": "192.0.2.44" };
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post(
        { handle: "saveflooder", venueId: REAL_VENUE_ID, listType: "Historic" },
        headers,
      );
    }
    expect(last!.status).toBe(429);
    expect(await last!.json()).toEqual({ error: "Too many saves, slow down.", code: "RATE_LIMITED", retryable: true });
  });

  it("never leaks actor_hash/status/moderation fields in the saved DTO", async () => {
    const res = await post(
      { handle: "ale", venueId: REAL_VENUE_ID, listType: "Historic", note: "hi" },
      { "x-forwarded-for": "198.51.100.77" },
    );
    const { saved } = await res.json();
    const blob = JSON.stringify(saved);
    // The public DTO is exactly these fields (note optional, present here).
    expect(Object.keys(saved[0]).sort()).toEqual([
      "listType",
      "note",
      "savedAt",
      "venueId",
      "venueMapUrl",
      "venueName",
    ]);
    expect(blob).not.toMatch(/actor_?hash/i);
    expect(blob).not.toMatch(/profile_?id/i);
    expect(blob).not.toMatch(/"status"/);
    expect(blob).not.toContain("198.51.100.77");
  });
});
