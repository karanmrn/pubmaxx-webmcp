import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const contributionIdentityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "acct-a",
    actor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    handle: "alice",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => contributionIdentityState.resolution,
}));

vi.mock("@/lib/wantedResolve.server", () => ({
  resolveWantedPaste: async (paste: string) => {
    if (paste.toLowerCase().includes("dove")) {
      return {
        query: "Dove",
        sourceUrl: "",
        sourcePlatform: "none" as const,
        rawPaste: paste,
        status: "ready" as const,
        candidates: [
          {
            venueId: "venue-dove",
            venueName: "The Dove",
            venueKind: "curated" as const,
            address: "",
            contextLabel: "Hammersmith",
          },
        ],
      };
    }
    return {
      query: paste,
      sourceUrl: "",
      sourcePlatform: "none" as const,
      rawPaste: paste,
      status: "ready" as const,
      candidates: [],
    };
  },
}));

import { GET, POST } from "@/app/api/wanted/route";
import { POST as resolvePOST } from "@/app/api/wanted/resolve/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemorySavedLists,
  __resetMemorySavedPubs,
  memorySavedPubsStore,
} from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { __resetWanteds, memoryWantedStore } from "@/lib/wantedStore";

let REAL_VENUE_ID = "";
let NON_PUB_VENUE_ID = "";

beforeAll(async () => {
  const index = await getVenueIndex();
  REAL_VENUE_ID = [...index.values()].find((venue) => isPubVenueKind(venue.kind))?.id ?? "";
  NON_PUB_VENUE_ID = [...index.values()].find((venue) => venue.kind === "food")?.id ?? "";
  if (!REAL_VENUE_ID) throw new Error("venue index is empty");
  if (!NON_PUB_VENUE_ID) throw new Error("venue index has no non-pub venue");
});

function post(body: unknown, ip = "203.0.113.40"): Request {
  return new Request("http://localhost/api/wanted", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function get(qs = "", ip = "203.0.113.40"): Request {
  return new Request(`http://localhost/api/wanted${qs}`, {
    method: "GET",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  __resetWanteds();
  __resetMemorySavedPubs();
  __resetMemorySavedLists();
  __resetPintDrops();
  contributionIdentityState.resolution = {
    ok: true,
    accountId: "acct-a",
    actor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    handle: "alice",
  };
});

afterEach(() => vi.restoreAllMocks());

describe("GET/POST /api/wanted", () => {
  it("requires auth for list", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const res = await GET(get());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("creates and lists a Wanted for the owner only", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
        sourceUrl: "https://www.instagram.com/reel/abc/",
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.wanted.venueName).toBe("The Dove");

    const listed = await GET(get());
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.wanteds).toHaveLength(1);

    contributionIdentityState.resolution = {
      ok: true,
      accountId: "acct-b",
      actor: "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      handle: "bob",
    };
    const other = await GET(get());
    const otherBody = await other.json();
    expect(otherBody.wanteds).toHaveLength(0);
  });

  it("rate-limits creates", async () => {
    for (let i = 0; i < 20; i += 1) {
      await POST(
        post({
          venueId: `venue-${i}`,
          venueName: `Pub ${i}`,
          venueKind: "curated",
        }),
      );
    }
    const flooded = await POST(
      post({
        venueId: "venue-flood",
        venueName: "Flood",
        venueKind: "curated",
      }),
    );
    expect(flooded.status).toBe(429);
    const body = await flooded.json();
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("fulfils via action and returns envelope errors with publicApiError shape", async () => {
    await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
      }),
    );
    const fulfilled = await POST(post({ action: "fulfil", venueId: "venue-dove" }));
    expect(fulfilled.status).toBe(200);
    const body = await fulfilled.json();
    expect(body.fulfilled).toHaveLength(1);

    const bad = await POST(post({ action: "delete" }));
    expect(bad.status).toBe(404);
    const badBody = await bad.json();
    expect(badBody.code).toBe("NOT_FOUND");
    expect(badBody.error).toBeTruthy();
  });

  it("saves an unresolvable paste as pending", async () => {
    const res = await POST(
      post({
        action: "pending",
        rawPaste: "mystery riverside from a mate",
        sourceUrl: "https://www.tiktok.com/@x/video/1",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.wanted.venueKind).toBe("pending");
    expect(body.wanted.sourcePlatform).toBe("tiktok");
  });

  it("promotes an open resolved Wanted idempotently without publishing its provenance", async () => {
    const created = await POST(post({
      venueId: REAL_VENUE_ID,
      venueName: "Canonical pub",
      venueKind: "curated",
      sourceUrl: "https://www.instagram.com/reel/private-source/",
      note: "Meet after work",
    }));
    const wanted = (await created.json()).wanted;

    const first = await POST(post({
      action: "promote",
      id: wanted.id,
      listType: "Want to Visit",
    }));
    const retry = await POST(post({
      action: "promote",
      id: wanted.id,
      listType: "Want to Visit",
    }));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await first.json()).toMatchObject({
      outcome: "saved",
      listType: "Want to Visit",
      listUrl: "/u/alice/lists/Want%20to%20Visit",
      wanted: { promotedListType: "Want to Visit" },
    });
    expect(await retry.json()).toMatchObject({ outcome: "already_saved" });
    const saved = await memorySavedPubsStore.listSaved({ handle: "alice" });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.note).toBeUndefined();
    const privateWanted = await memoryWantedStore.getById(
      "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      wanted.id,
    );
    expect(privateWanted?.sourceUrl).toContain("instagram.com");
    expect(privateWanted?.note).toBe("Meet after work");
    expect(privateWanted?.promotedListType).toBe("Want to Visit");
  });

  it("refuses pending, fulfilled, unknown, and another owner's Wanted", async () => {
    const pending = await POST(post({ action: "pending", rawPaste: "mystery pub" }));
    const pendingId = (await pending.json()).wanted.id;
    const pendingPromotion = await POST(post({
      action: "promote",
      id: pendingId,
      listType: "Want to Visit",
    }));
    expect(pendingPromotion.status).toBe(409);

    const nonPub = await POST(post({
      venueId: NON_PUB_VENUE_ID,
      venueName: "Late food",
      venueKind: "curated",
    }));
    const nonPubId = (await nonPub.json()).wanted.id;
    expect((await POST(post({
      action: "promote",
      id: nonPubId,
      listType: "Want to Visit",
    }))).status).toBe(409);

    const created = await POST(post({
      venueId: REAL_VENUE_ID,
      venueName: "Canonical pub",
      venueKind: "curated",
    }));
    const wanted = (await created.json()).wanted;
    await POST(post({ action: "fulfil", venueId: REAL_VENUE_ID }));
    const fulfilledPromotion = await POST(post({
      action: "promote",
      id: wanted.id,
      listType: "Want to Visit",
    }));
    expect(fulfilledPromotion.status).toBe(409);

    expect((await POST(post({
      action: "promote",
      id: "missing",
      listType: "Want to Visit",
    }))).status).toBe(404);

    contributionIdentityState.resolution = {
      ok: true,
      accountId: "acct-b",
      actor: "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      handle: "bob",
    };
    expect((await POST(post({
      action: "promote",
      id: wanted.id,
      listType: "Want to Visit",
    }))).status).toBe(404);
  });

  it("allows only one public list when different promotions race", async () => {
    const created = await POST(post({
      venueId: REAL_VENUE_ID,
      venueName: "Canonical pub",
      venueKind: "curated",
    }));
    const wanted = (await created.json()).wanted;

    const responses = await Promise.all([
      POST(post({ action: "promote", id: wanted.id, listType: "Want to Visit" })),
      POST(post({ action: "promote", id: wanted.id, listType: "Historic" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await memorySavedPubsStore.listSaved({ handle: "alice" });
    expect(saved).toHaveLength(1);
    const recorded = await memoryWantedStore.getById(
      "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      wanted.id,
    );
    expect(recorded?.promotedListType).toBe(saved[0]?.listType);
  });
});

describe("POST /api/wanted/resolve", () => {
  it("returns candidates for a known name", async () => {
    const res = await resolvePOST(
      new Request("http://localhost/api/wanted/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.41" },
        body: JSON.stringify({ paste: "The Dove" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates[0]?.venueId).toBe("venue-dove");
  });

  it("requires auth", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const res = await resolvePOST(
      new Request("http://localhost/api/wanted/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paste: "Dove" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
