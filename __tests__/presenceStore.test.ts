import { beforeEach, describe, expect, it } from "vitest";

// Exercise the in-memory presence store directly — no live Supabase, no env
// keys. It is the backend the route uses when Supabase is unconfigured, and it
// shares the clean/cap + expiry logic with the Supabase path.
//
// FORCE the in-memory path: on Vercel vitest runs with the project's env set —
// if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the store would try to
// select the Supabase client (network) and these cases would fail only in CI.
// Clearing them in beforeEach pins the store to memory everywhere. We also reset
// the shared memory map so cases can't leak presence into each other, and inject
// a fixed clock so expiry/refresh are deterministic (no wall-clock flake).
import {
  markPresence,
  recentPresence,
  __resetPresence,
  PRESENCE_TTL_MS,
  type PresenceDTO,
} from "@/lib/presenceStore";

const HANDLE = "old_ken";
const OTHER_HANDLE = "riverside_sam";
// A venue id from the bundled dataset resolves to a real pub name; an unknown id
// falls back to "A London pub". The tests below only assert the DTO *shape* +
// that a name is present, so they pass regardless of which id is used.
const VENUE = "venue-test-1";
const OTHER_VENUE = "venue-test-2";
const ACTOR = "actor-hash-abc";
const OTHER_ACTOR = "actor-hash-xyz";

const T0 = Date.UTC(2026, 6, 6, 20, 0, 0); // fixed "tonight" clock

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPresence();
});

describe("markPresence + recentPresence — the happy path", () => {
  it("returns a marked presence as a public DTO", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);
    const rows = await recentPresence(undefined, T0 + 60_000);
    expect(rows).toHaveLength(1);
    expect(rows[0].handle).toBe(HANDLE);
    expect(rows[0].venueId).toBe(VENUE);
    expect(typeof rows[0].at).toBe("string");
  });

  it("scopes recentPresence to a single venue when asked", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);
    await markPresence({ handle: OTHER_HANDLE, venueId: OTHER_VENUE, actorHash: OTHER_ACTOR }, T0);

    const all = await recentPresence(undefined, T0 + 1);
    expect(all).toHaveLength(2);

    const scoped = await recentPresence(VENUE, T0 + 1);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].venueId).toBe(VENUE);
  });
});

describe("expiry", () => {
  it("excludes a row past its 2h expiry window", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);

    // Just inside the window → present.
    const live = await recentPresence(undefined, T0 + PRESENCE_TTL_MS - 1);
    expect(live).toHaveLength(1);

    // Past the window → gone (server filters expires_at > now).
    const expired = await recentPresence(undefined, T0 + PRESENCE_TTL_MS + 1);
    expect(expired).toHaveLength(0);
  });
});

describe("re-mark refreshes expiry (UPSERT on actor+venue)", () => {
  it("keeps ONE row per actor+venue and refreshes its expiry, not two rows", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);

    // Re-mark the SAME actor+venue an hour later — this must refresh in place.
    const later = T0 + 60 * 60 * 1000;
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, later);

    // Exactly one row (not two): the unique (actor_hash, venue_id) key upserts.
    const rows = await recentPresence(undefined, later + 1);
    expect(rows).toHaveLength(1);

    // The refreshed row now lives 2h from the *second* mark: it survives past
    // where the original would have expired.
    const originalExpiry = T0 + PRESENCE_TTL_MS;
    const stillLive = await recentPresence(undefined, originalExpiry + 1);
    expect(stillLive).toHaveLength(1);
  });

  it("updates the stored handle on a re-mark", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);
    await markPresence({ handle: "renamed_ken", venueId: VENUE, actorHash: ACTOR }, T0 + 1000);
    const rows = await recentPresence(undefined, T0 + 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0].handle).toBe("renamed_ken");
  });
});

describe("public DTO — no actor_hash leak", () => {
  it("carries venueName + venueMapUrl and NEVER an actor_hash", async () => {
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0);
    const rows = await recentPresence(undefined, T0 + 1);
    expect(rows).toHaveLength(1);
    const dto: PresenceDTO = rows[0];

    // Enriched public fields present.
    expect(typeof dto.venueName).toBe("string");
    expect(dto.venueName.length).toBeGreaterThan(0);
    expect(dto.venueMapUrl).toBe(`/map?sel=${encodeURIComponent(VENUE)}`);

    // The actor hash must never cross the seam — assert on the serialized shape
    // so an accidental extra field would be caught too.
    expect(dto).not.toHaveProperty("actor_hash");
    expect(dto).not.toHaveProperty("actorHash");
    expect(JSON.stringify(dto)).not.toContain(ACTOR);
    expect(Object.keys(dto).sort()).toEqual(
      ["at", "handle", "venueId", "venueMapUrl", "venueName"].sort(),
    );
  });
});

describe("input hygiene", () => {
  it("ignores a blank handle / venue / actor (no row written)", async () => {
    await markPresence({ handle: "", venueId: VENUE, actorHash: ACTOR }, T0);
    await markPresence({ handle: HANDLE, venueId: "", actorHash: ACTOR }, T0);
    await markPresence({ handle: HANDLE, venueId: VENUE, actorHash: "" }, T0);
    const rows = await recentPresence(undefined, T0 + 1);
    expect(rows).toHaveLength(0);
  });

  it("strips inline HTML / control chars from the stored handle", async () => {
    await markPresence(
      { handle: "  ev<il>il  spacer ", venueId: VENUE, actorHash: ACTOR },
      T0,
    );
    const rows = await recentPresence(undefined, T0 + 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].handle).not.toContain("<");
    expect(rows[0].handle).not.toContain(">");
  });
});

describe("fail-soft contract", () => {
  it("recentPresence never throws — returns [] when there is nothing", async () => {
    await expect(recentPresence(undefined, T0)).resolves.toEqual([]);
    await expect(recentPresence("venue-nobody-here", T0)).resolves.toEqual([]);
  });

  it("markPresence resolves (never rejects) even on odd input", async () => {
    await expect(
      markPresence({ handle: HANDLE, venueId: VENUE, actorHash: ACTOR }, T0),
    ).resolves.toBeUndefined();
    await expect(
      markPresence({ handle: "", venueId: "", actorHash: "" }, T0),
    ).resolves.toBeUndefined();
  });
});
