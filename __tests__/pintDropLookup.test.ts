import { beforeEach, describe, expect, it } from "vitest";

// getPintDropById is the single leak-proof permalink read (/p/[id] + its OG
// card). It has two paths chosen by isSupabaseConfigured(): a Supabase read that
// names ONLY public columns, and a memory fallback over listAllVisiblePintDrops
// (which always includes the demo seeds). We exercise the memory path here.
//
// FORCE the memory path: on Vercel vitest runs with the project's env set — if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present, isSupabaseConfigured()
// would be true and the read would try to hit the network (and fail only in CI).
// Clearing them in beforeEach pins the lookup to its memory fallback everywhere,
// which resolves demo-seeded drops from the bundled dataset — deterministic and
// offline.
import { getPintDropById } from "@/lib/pintDropLookup";
import { demoPintDrops } from "@/lib/pintDropSeeds";
import { getVenueIndex } from "@/lib/venueIndex";

// A real demo seed that always rides the in-memory read path. Its venueId
// resolves to a curated heritage pub in the bundled dataset, so enrichment
// produces a real venue NAME (not the friendly fallback).
const SEED = demoPintDrops[0];

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("getPintDropById — resolves a known visible drop (memory path)", () => {
  it("returns the seed drop enriched with a real venue name + map link", async () => {
    const index = await getVenueIndex();
    const expectedName = index.get(SEED.venueId)?.name;
    expect(expectedName, "dataset must resolve the seed venue").toBeTruthy();

    const drop = await getPintDropById(SEED.id);
    expect(drop).not.toBeNull();
    expect(drop!.id).toBe(SEED.id);
    expect(drop!.venueId).toBe(SEED.venueId);
    // Enrichment: the raw id becomes a real pub NAME + a map link, never the id.
    expect(drop!.venueName).toBe(expectedName);
    expect(drop!.venueName).not.toBe("A London pub");
    expect(drop!.venueName).not.toMatch(/^venue-/);
    expect(drop!.venueMapUrl).toBe(`/map?sel=${encodeURIComponent(SEED.venueId)}`);
    // Content the permalink renders rides through faithfully.
    expect(drop!.handle).toBe(SEED.handle);
    expect(drop!.note).toBe(SEED.passedDownNote);
    expect(drop!.priceGbp).toBe(SEED.priceGbp);
    // The memory store has no Storage, so no photo URLs.
    expect(drop!.pintPhotoUrl).toBeNull();
    expect(drop!.venuePhotoUrl).toBeNull();
  });

  it("trims a padded id before resolving it", async () => {
    const drop = await getPintDropById(`   ${SEED.id}   `);
    expect(drop).not.toBeNull();
    expect(drop!.id).toBe(SEED.id);
  });
});

describe("getPintDropById — unknown / empty ids resolve to null (never throw)", () => {
  it("returns null for an unknown id", async () => {
    expect(await getPintDropById("does-not-exist")).toBeNull();
  });

  it("returns null for an empty / whitespace / non-string id", async () => {
    expect(await getPintDropById("")).toBeNull();
    expect(await getPintDropById("   ")).toBeNull();
    // A non-string id is coerced to "" and short-circuits to null, never throws.
    expect(await getPintDropById(undefined as unknown as string)).toBeNull();
    expect(await getPintDropById(null as unknown as string)).toBeNull();
    expect(await getPintDropById(123 as unknown as string)).toBeNull();
  });
});

describe("PublicDrop DTO — leak-proof by column selection", () => {
  it("carries NO report_*/moderator_*/status/actor_hash/photo-key fields", async () => {
    const drop = await getPintDropById(SEED.id);
    expect(drop).not.toBeNull();

    const forbidden = [
      "status",
      "actor_hash",
      "actorHash",
      "reportCount",
      "reportReason",
      "reportedAt",
      "moderatorNote",
      "moderatedAt",
      "pintPhotoKey",
      "venuePhotoKey",
      "pint_photo_key",
      "venue_photo_key",
    ];
    for (const key of forbidden) expect(drop).not.toHaveProperty(key);

    // The DTO exposes exactly the sanctioned public surface — nothing more.
    expect(Object.keys(drop!).sort()).toEqual(
      [
        "createdAt",
        "drink",
        "era",
        "handle",
        "id",
        "note",
        "pintPhotoUrl",
        "priceGbp",
        "provenance",
        "venueId",
        "venueMapUrl",
        "venueName",
        "venuePhotoUrl",
        "vibeTags",
        "visibility",
      ].sort(),
    );

    // No moderation trail leaks even when serialized.
    const serialized = JSON.stringify(drop);
    expect(serialized).not.toContain("report");
    expect(serialized).not.toContain("moderat");
    expect(serialized).not.toContain("photo_key");
  });

  it("normalizes vibeTags to an array (never undefined) on a tagless seed", async () => {
    const drop = await getPintDropById(SEED.id);
    expect(Array.isArray(drop!.vibeTags)).toBe(true);
  });
});
