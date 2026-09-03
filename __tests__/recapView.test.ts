import { describe, expect, it } from "vitest";

import {
  buildRecapShareText,
  composeRecapFromCompletion,
  composeRecapFromPublishedStory,
  dryLondonClosingLine,
  endingView,
  formatGbp,
  guardianView,
  selectPublishedRecapMoments,
  type RecapPint,
} from "@/lib/recapView";
import type { NightMoment, NightStory } from "@/lib/nightMemory";
import type { EndingSelection } from "@/lib/plan";
import type { PintDrop } from "@/lib/pintDropShared";

function moment(overrides: Partial<NightMoment>): NightMoment {
  return {
    id: overrides.id ?? "m1",
    memoryId: "mem1",
    ownerId: overrides.ownerId ?? "owner-1",
    kind: overrides.kind ?? "venue",
    caption: overrides.caption ?? "",
    pintDropId: overrides.pintDropId ?? null,
    venueId: overrides.venueId ?? null,
    mediaObjectKey: overrides.mediaObjectKey ?? null,
    occurredAt: overrides.occurredAt ?? null,
    visibility: "private",
    altText: overrides.altText ?? null,
    altTextConfirmedAt: overrides.altTextConfirmedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-17T22:00:00.000Z",
  };
}

function story(overrides: Partial<NightStory>): NightStory {
  return {
    id: "s1",
    memoryId: "mem1",
    hostEditorId: "owner-1",
    title: overrides.title ?? "Big Friday",
    summary: "",
    status: overrides.status ?? "published",
    visibility: overrides.visibility ?? "public",
    legacyCrawlStoryId: null,
    publishedMomentIds: overrides.publishedMomentIds ?? [],
    publishedAt: overrides.publishedAt ?? "2026-07-18T09:00:00.000Z",
    createdAt: "2026-07-17T20:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
  };
}

describe("formatGbp", () => {
  it("renders two decimal places", () => {
    expect(formatGbp(4.8)).toBe("£4.80");
    expect(formatGbp(12)).toBe("£12.00");
  });
});

describe("endingView", () => {
  it("returns null for an unknown ending", () => {
    expect(endingView(null, null)).toBeNull();
    expect(endingView("mystery" as never, null)).toBeNull();
  });

  it("prefers the persisted evidence label", () => {
    const selection: EndingSelection = {
      kind: "food",
      optionId: "food:kebab",
      externalPlaceId: "place-1",
      evidenceSnapshot: { label: "Efes Kebab House", confidence: "high" },
    };
    expect(endingView("food", selection)).toEqual({ kind: "food", label: "Efes Kebab House" });
  });

  it("falls back to a plain label when there is no evidence", () => {
    expect(endingView("get_home", null)).toEqual({ kind: "get_home", label: "Everyone headed home" });
  });
});

describe("guardianView", () => {
  const leaveBy = "2026-07-17T23:42:00.000Z";

  it("only surfaces on a get_home ending", () => {
    expect(
      guardianView({ ending: "food", dropCreatedAt: "2026-07-17T23:30:00.000Z", leaveByIso: leaveBy, decision: "order_one_more" }),
    ).toBeNull();
  });

  it("reports a safe save when the crew left in time", () => {
    expect(
      guardianView({ ending: "get_home", dropCreatedAt: "2026-07-17T23:30:00.000Z", leaveByIso: leaveBy, decision: "settle_up_now" }),
    ).toEqual({ label: "Home before the last train", tone: "safe" });
  });

  it("reports a risk when they lingered past the leave-by", () => {
    expect(
      guardianView({ ending: "get_home", dropCreatedAt: "2026-07-18T00:10:00.000Z", leaveByIso: leaveBy, decision: "train_risk" }),
    ).toEqual({ label: "Out past the last train", tone: "risk" });
  });

  it("never invents a save without a live decision", () => {
    expect(
      guardianView({ ending: "get_home", dropCreatedAt: "2026-07-17T23:30:00.000Z", leaveByIso: leaveBy, decision: "live_data_unavailable" as never }),
    ).toBeNull();
    expect(guardianView({ ending: "get_home" })).toBeNull();
  });
});

describe("dryLondonClosingLine", () => {
  it("is deterministic and keyed to the guardian tone", () => {
    const safe = dryLondonClosingLine({ ending: null, guardian: { label: "x", tone: "safe" }, stats: { stopCount: 3, pintCount: 0, totalGbp: null, cheapestPintGbp: null } });
    expect(safe).toBe("The night ended before the last train.");
    expect(dryLondonClosingLine({ ending: null, guardian: { label: "x", tone: "safe" }, stats: { stopCount: 3, pintCount: 0, totalGbp: null, cheapestPintGbp: null } })).toBe(safe);
  });

  it("has a line for each ending", () => {
    expect(dryLondonClosingLine({ ending: { kind: "food", label: "" }, guardian: null, stats: { stopCount: 2, pintCount: 0, totalGbp: null, cheapestPintGbp: null } })).toContain("food");
    expect(dryLondonClosingLine({ ending: { kind: "keep_going", label: "" }, guardian: null, stats: { stopCount: 2, pintCount: 0, totalGbp: null, cheapestPintGbp: null } })).toBe("The night continued after this route ended.");
  });
});

describe("composeRecapFromCompletion", () => {
  it("orders the route by position and gates empty sections", () => {
    const view = composeRecapFromCompletion({
      title: "  ",
      completedAt: "2026-07-18T00:00:00.000Z",
      ending: "get_home",
      endingSelection: null,
      stops: [
        { venueId: "b", venueName: "The Second", position: 1 },
        { venueId: "a", venueName: "The First", position: 0, caption: "  where it started  " },
      ],
    });
    expect(view.title).toBe("Tonight's Memory");
    expect(view.route.map((stop) => stop.venueName)).toEqual(["The First", "The Second"]);
    expect(view.route[0].caption).toBe("where it started");
    expect(view.route[1].caption).toBeNull();
    expect(view.pints).toEqual([]);
    expect(view.photos).toEqual([]);
    expect(view.ending).toEqual({ kind: "get_home", label: "Everyone headed home" });
    expect(view.stats.stopCount).toBe(2);
  });

  it("sums only real logged prices into the total", () => {
    const pints: RecapPint[] = [
      { venueId: "a", venueName: "The First", drink: "Neck Oil", priceGbp: 4.8, priceLabel: "£4.80", note: null },
      { venueId: "b", venueName: "The Second", drink: "Guinness", priceGbp: 6.2, priceLabel: "£6.20", note: null },
      { venueId: "c", venueName: "The Third", drink: null, priceGbp: null, priceLabel: null, note: "cash only, sorry" },
    ];
    const view = composeRecapFromCompletion({
      title: "Crawl",
      completedAt: null,
      ending: "food",
      stops: [{ venueId: "a", venueName: "The First", position: 0 }],
      pints,
    });
    expect(view.stats.pintCount).toBe(3);
    expect(view.stats.totalGbp).toBe(11);
    expect(view.stats.cheapestPintGbp).toBe(4.8);
    expect(view.pints).toHaveLength(3);
  });

  it("surfaces a guardian save from live last-train context", () => {
    const view = composeRecapFromCompletion({
      title: "Home run",
      completedAt: null,
      ending: "get_home",
      stops: [{ venueId: "a", venueName: "The First", position: 0 }],
      lastTrain: { dropCreatedAt: "2026-07-17T23:30:00.000Z", leaveByIso: "2026-07-17T23:42:00.000Z", decision: "settle_up_now" },
    });
    expect(view.guardian).toEqual({ label: "Home before the last train", tone: "safe" });
    expect(view.closingLine).toBe("The night ended before the last train.");
  });
});

describe("selectPublishedRecapMoments (public gate)", () => {
  const m1 = moment({ id: "m1", kind: "venue", venueId: "a" });
  const m2 = moment({ id: "m2", kind: "photo", mediaObjectKey: "night/b.jpg" });

  it("returns nothing for a draft story", () => {
    expect(selectPublishedRecapMoments([m1, m2], story({ status: "draft", publishedMomentIds: ["m1", "m2"] }))).toEqual([]);
  });

  it("returns nothing for a private story even if published", () => {
    expect(selectPublishedRecapMoments([m1, m2], story({ visibility: "private", publishedMomentIds: ["m1"] }))).toEqual([]);
  });

  it("returns only moments in the published allowlist", () => {
    const result = selectPublishedRecapMoments([m1, m2], story({ publishedMomentIds: ["m1"] }));
    expect(result.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("composeRecapFromPublishedStory", () => {
  it("refuses to compose an unpublished or private story", () => {
    expect(composeRecapFromPublishedStory({ story: story({ status: "draft" }), moments: [] })).toBeNull();
    expect(composeRecapFromPublishedStory({ story: story({ visibility: "private" }), moments: [] })).toBeNull();
  });

  it("composes route, priced pints and approved photos from published moments only", () => {
    const venue = moment({ id: "v-1", kind: "venue", venueId: "pub-a", caption: "kicked off here", occurredAt: "2026-07-17T20:00:00.000Z" });
    const pint = moment({ id: "d-1", kind: "pint_drop", pintDropId: "111e1111-1111-4111-8111-111111111111", venueId: "pub-a" });
    const approvedPhoto = moment({ id: "ph-1", kind: "photo", mediaObjectKey: "night/first.jpg", venueId: "pub-a" });
    const hiddenPhoto = moment({ id: "ph-2", kind: "photo", mediaObjectKey: "night/secret.jpg" });
    const missingDropId = moment({ id: "d-2", kind: "pint_drop", pintDropId: null, venueId: "pub-b" });
    const drop: PintDrop = {
      id: "111e1111-1111-4111-8111-111111111111",
      venueId: "pub-a",
      handle: "sam",
      drink: "Neck Oil",
      priceGbp: 5.4,
      passedDownNote: "",
      era: "now",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-07-17T21:00:00.000Z",
    };
    const view = composeRecapFromPublishedStory({
      story: story({ publishedMomentIds: ["v-1", "d-1", "d-2", "ph-1"] }),
      moments: [venue, pint, missingDropId, approvedPhoto, hiddenPhoto],
      pintDropsById: new Map([[drop.id, drop]]),
      venueNames: new Map([["pub-a", "The Old Blue Last"]]),
    });
    expect(view).not.toBeNull();
    expect(view?.route.map((s) => s.venueName)).toEqual(["The Old Blue Last"]);
    expect(view?.pints[0]).toMatchObject({ venueName: "The Old Blue Last", drink: "Neck Oil", priceLabel: "£5.40" });
    // Only the published photo appears; the withheld one never leaks.
    expect(view?.photos.map((p) => p.id)).toEqual(["ph-1"]);
    expect(view?.stats.totalGbp).toBe(5.4);
    expect(view?.stats.cheapestPintGbp).toBe(5.4);
    expect(view?.stats.pintCount).toBe(2);
    expect(view?.pints).toHaveLength(2);
    expect(view?.pints[0].priceGbp).toBe(5.4);
  });
});

describe("buildRecapShareText", () => {
  it("matches the shareArtifacts builder shape and names where it was logged", () => {
    expect(buildRecapShareText({ title: "Big Friday", stopCount: 3, totalGbp: 18.4 })).toBe(
      "Big Friday. 3 stops, £18.40 across the night. Night logged on PUBMAXX.",
    );
  });

  it("omits missing data honestly", () => {
    expect(buildRecapShareText({ title: "", stopCount: 0 })).toBe("Our night out. Night logged on PUBMAXX.");
    expect(buildRecapShareText({ title: "Solo one", stopCount: 1, totalGbp: null })).toBe(
      "Solo one. 1 stop. Night logged on PUBMAXX.",
    );
  });
});
