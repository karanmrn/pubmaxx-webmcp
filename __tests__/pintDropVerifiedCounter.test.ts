import { afterEach, describe, expect, it } from "vitest";

import {
  __resetPintDrops,
  addPintDrop,
  listVisiblePintDrops,
  reportPintDrop,
  type PintDrop,
  type PintDropReportIdentity,
} from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";

const VENUE_ID = "venue-legacy-counter";

const verified = (actorHash: string): PintDropReportIdentity => ({
  kind: "verified_account",
  actorHash,
});

afterEach(() => __resetPintDrops());

describe("verified Pint Drop report counter boundary", () => {
  it("does not let one verified report hide a drop with a legacy report count", async () => {
    const legacyDrop: PintDrop = {
      id: "drop-with-legacy-report",
      venueId: VENUE_ID,
      handle: "alice",
      drink: "lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-08-23T10:00:00.000Z",
      reportCount: 7,
    };
    addPintDrop(legacyDrop);

    expect(reportPintDrop(legacyDrop.id, "wrong price", verified("account-a"))).toBe(true);
    expect(listVisiblePintDrops(VENUE_ID)).toHaveLength(1);
    expect(legacyDrop.reportCount).toBe(7);
    await expect(memoryPintDropStore.listVisible(VENUE_ID)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ reportCount: 1 })]),
    );

    expect(reportPintDrop(legacyDrop.id, "still wrong", verified("account-b"))).toBe(true);
    expect(listVisiblePintDrops(VENUE_ID)).toHaveLength(0);
  });

  it("keeps an anonymous report outside the verified counter even when actor hashes match", () => {
    const drop: PintDrop = {
      id: "drop-with-shared-hash",
      venueId: VENUE_ID,
      handle: "alice",
      drink: "lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-08-23T10:00:00.000Z",
      reportCount: 1,
    };
    addPintDrop(drop);

    expect(reportPintDrop(drop.id, "anonymous flag", { kind: "anonymous_ip", actorHash: "shared" })).toBe(true);
    expect(reportPintDrop(drop.id, "account flag", verified("shared"))).toBe(true);
    expect(listVisiblePintDrops(VENUE_ID)).toHaveLength(1);

    expect(reportPintDrop(drop.id, "second account flag", verified("account-b"))).toBe(true);
    expect(listVisiblePintDrops(VENUE_ID)).toHaveLength(0);
  });

  it("does not expose a legacy report count before a verified report exists", async () => {
    const legacyVisibleDrop: PintDrop = {
      id: "legacy-only-visible-drop",
      venueId: VENUE_ID,
      handle: "alice",
      drink: "lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-08-23T10:00:00.000Z",
      reportCount: 1,
    };
    const legacyPendingDrop: PintDrop = {
      ...legacyVisibleDrop,
      id: "legacy-only-pending-drop",
      status: "pending",
    };
    addPintDrop(legacyVisibleDrop);
    addPintDrop(legacyPendingDrop);

    const publicRows = await memoryPintDropStore.listVisible(VENUE_ID);
    expect(publicRows).toEqual([
      expect.not.objectContaining({ reportCount: expect.any(Number) }),
    ]);

    const moderationRows = await memoryPintDropStore.listForReview("pending");
    expect(moderationRows).toEqual([
      expect.objectContaining({ id: legacyPendingDrop.id, reportCount: 0 }),
    ]);
  });
});
