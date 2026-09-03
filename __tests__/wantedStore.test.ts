import { beforeEach, describe, expect, it } from "vitest";

import { __resetWanteds, memoryWantedStore } from "@/lib/wantedStore";

const OWNER_A = "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OWNER_B = "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  __resetWanteds();
});

describe("wanted store privacy + fulfil", () => {
  it("lists only the owner's Wanteds", async () => {
    await memoryWantedStore.create({
      ownerActor: OWNER_A,
      venueKind: "curated",
      venueId: "venue-a",
      venueName: "Pub A",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "Pub A",
    });
    await memoryWantedStore.create({
      ownerActor: OWNER_B,
      venueKind: "curated",
      venueId: "venue-b",
      venueName: "Pub B",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "Pub B",
    });

    const a = await memoryWantedStore.listForOwner(OWNER_A);
    const b = await memoryWantedStore.listForOwner(OWNER_B);
    expect(a.wanteds).toHaveLength(1);
    expect(a.wanteds[0]?.venueId).toBe("venue-a");
    expect(b.wanteds).toHaveLength(1);
    expect(b.wanteds[0]?.venueId).toBe("venue-b");
    expect(await memoryWantedStore.getById(OWNER_A, b.wanteds[0]!.id)).toBeNull();
  });

  it("fulfils open Wanteds for a venue and leaves others open", async () => {
    await memoryWantedStore.create({
      ownerActor: OWNER_A,
      venueKind: "curated",
      venueId: "venue-hit",
      venueName: "Hit Pub",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "Hit Pub",
    });
    await memoryWantedStore.create({
      ownerActor: OWNER_A,
      venueKind: "curated",
      venueId: "venue-other",
      venueName: "Other Pub",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "Other Pub",
    });

    const fulfilled = await memoryWantedStore.fulfilForVenue(OWNER_A, "venue-hit");
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.status).toBe("fulfilled");
    expect(fulfilled[0]?.fulfilledAt).toBeTruthy();

    const open = await memoryWantedStore.listOpenForOwner(OWNER_A);
    expect(open.wanteds).toHaveLength(1);
    expect(open.wanteds[0]?.venueId).toBe("venue-other");
  });

  it("never fulfils another owner's Wanted at the same venue", async () => {
    await memoryWantedStore.create({
      ownerActor: OWNER_B,
      venueKind: "curated",
      venueId: "venue-shared",
      venueName: "Shared",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "Shared",
    });
    const fulfilled = await memoryWantedStore.fulfilForVenue(OWNER_A, "venue-shared");
    expect(fulfilled).toHaveLength(0);
    const still = await memoryWantedStore.listOpenForOwner(OWNER_B);
    expect(still.wanteds).toHaveLength(1);
    expect(still.wanteds[0]?.status).toBe("open");
  });
});
