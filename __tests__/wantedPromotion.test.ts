import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemorySavedPubs,
  memorySavedPubsStore,
} from "@/lib/savedPubsStore";
import { __resetWanteds, memoryWantedStore } from "@/lib/wantedStore";

const INPUT = {
  profileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  handle: "alice",
  venueId: "venue-promotion",
  listType: "Want to Visit",
};

beforeEach(() => {
  __resetMemorySavedPubs();
  __resetWanteds();
});

describe("Wanted promotion state", () => {
  it("records the selected list on the owner-scoped Wanted", async () => {
    const wanted = await memoryWantedStore.create({
      ownerActor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      venueKind: "curated",
      venueId: "venue-promotion",
      venueName: "The Fox",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "The Fox",
    });

    const promoted = await memoryWantedStore.recordPromotion(
      wanted.ownerActor,
      wanted.id,
      "Want to Visit",
      Date.parse("2026-08-24T10:00:00.000Z"),
    );

    expect(promoted).toMatchObject({
      promotedListType: "Want to Visit",
      promotedAt: "2026-08-24T10:00:00.000Z",
    });
    expect(await memoryWantedStore.getById(wanted.ownerActor, wanted.id))
      .toMatchObject({ promotedListType: "Want to Visit" });
  });

  it("refuses promotion after fulfilment", async () => {
    const wanted = await memoryWantedStore.create({
      ownerActor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      venueKind: "curated",
      venueId: "venue-promotion",
      venueName: "The Fox",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "The Fox",
    });
    await memoryWantedStore.fulfilForVenue(wanted.ownerActor, wanted.venueId);

    await expect(memoryWantedStore.recordPromotion(
      wanted.ownerActor,
      wanted.id,
      "Want to Visit",
    )).resolves.toBeNull();
  });
});

describe("Wanted public-list promotion", () => {
  it("ensures a save without toggling it off on retry", async () => {
    await expect(memorySavedPubsStore.ensureSaved(INPUT)).resolves.toEqual({
      outcome: "saved",
    });
    await expect(memorySavedPubsStore.ensureSaved(INPUT)).resolves.toEqual({
      outcome: "already_saved",
    });

    const saved = await memorySavedPubsStore.listSaved({ handle: "alice" });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      venueId: "venue-promotion",
      listType: "Want to Visit",
    });
  });

  it("keeps one saved row across concurrent promotion attempts", async () => {
    const outcomes = await Promise.all([
      memorySavedPubsStore.ensureSaved(INPUT),
      memorySavedPubsStore.ensureSaved(INPUT),
    ]);

    expect(outcomes).toContainEqual({ outcome: "saved" });
    expect(outcomes).toContainEqual({ outcome: "already_saved" });
    await expect(memorySavedPubsStore.listSaved({ handle: "alice" }))
      .resolves.toHaveLength(1);
  });
});
