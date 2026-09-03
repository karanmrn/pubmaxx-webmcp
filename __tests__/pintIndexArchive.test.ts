import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import type { PintIndexSnapshot } from "@/lib/pintIndex";
import { canonicalObservationsPayload as canonicalPayload } from "@/lib/pintIndexCanonical.mjs";
import {
  amendArchivedMonth,
  buildArchivedMonth,
  canonicalObservationsPayload,
  londonMonthOf,
  monthPublishBlocker,
  monthPublishFloorBlocker,
  PINT_INDEX_PUBLIC_START_MONTH,
  pintIndexMonthLabel,
  pintIndexMonthTemporalCoverage,
  pintIndexMonthWindow,
  planArchivePublish,
  validateArchivedPintIndexSnapshot,
  type ArchivedPintIndexSnapshot,
} from "@/lib/pintIndexArchive";

const sha256 = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

const live = (over: Partial<PintIndexSnapshot> = {}): PintIndexSnapshot => ({
  schemaVersion: 1,
  snapshotId: "london-pint-index-public-v1",
  status: "published",
  generatedAt: "2026-07-16T00:00:00.000Z",
  observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-15T23:59:59.000Z" },
  classification: {
    version: LONDON_BOROUGH_CLASSIFIER_VERSION,
    method: "point_in_polygon",
    sourceArtifact: "data/london_boroughs_simplified.json",
    licence: "Open Government Licence v3.0",
  },
  sources: [
    {
      id: "drop-1",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/1",
      licence: null,
      confirmationId: "confirmation-1",
      reviewState: "confirmed",
    },
    {
      id: "drop-2",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/2",
      licence: null,
      confirmationId: "confirmation-2",
      reviewState: "confirmed",
    },
  ],
  observations: [
    { venueId: "a", pubName: "June Pub", boroughCode: "hackney", boroughName: "Hackney", pricePence: 520, observedAt: "2026-06-10T18:00:00.000Z", sourceId: "drop-1" },
    { venueId: "b", pubName: "Also June", boroughCode: "camden", boroughName: "Camden", pricePence: 640, observedAt: "2026-06-30T23:59:00.000Z", sourceId: "drop-1" },
    { venueId: "c", pubName: "July Pub", boroughCode: "camden", boroughName: "Camden", pricePence: 700, observedAt: "2026-07-02T12:00:00.000Z", sourceId: "drop-2" },
  ],
  excluded: [{ reason: "source_not_eligible_for_public_index", observationCount: 2796, note: "Legacy baseline quarantined." }],
  ...over,
});

const freeze = (snapshot = live(), month = "2026-06", publishedAt = "2026-07-01T09:00:00.000Z") =>
  buildArchivedMonth({ snapshot, month, publishedAt, sha256 });

describe("monthly Pint Index editions", () => {
  it("frames a month as its own exact, citable window", () => {
    expect(pintIndexMonthWindow("2026-06")).toEqual({
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-30T23:59:59.999Z",
    });
    expect(pintIndexMonthTemporalCoverage("2026-06")).toBe("2026-06-01/2026-06-30");
    expect(pintIndexMonthLabel("2026-06")).toBe("June 2026");
    // February and the year boundary are where naive month maths breaks.
    expect(pintIndexMonthWindow("2028-02").end).toBe("2028-02-29T23:59:59.999Z");
    expect(pintIndexMonthWindow("2026-12").end).toBe("2026-12-31T23:59:59.999Z");
  });

  it("freezes only the observations valid in that window, and the sources they cite", () => {
    const edition = freeze();
    expect(edition.observations.map((row) => row.venueId)).toEqual(["a", "b"]);
    expect(edition.sources.map((source) => source.id)).toEqual(["drop-1"]);
    expect(edition.snapshotId).toBe("london-pint-index-2026-06");
    expect(edition.observationWindow).toEqual(pintIndexMonthWindow("2026-06"));
    expect(edition.archive.sourceSnapshotId).toBe("london-pint-index-public-v1");
    expect(validateArchivedPintIndexSnapshot(edition, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  it("does not change when the live index changes around it", () => {
    const before = freeze();
    const after = freeze(live({
      snapshotId: "london-pint-index-public-v2",
      generatedAt: "2026-08-01T00:00:00.000Z",
      observations: [
        ...live().observations,
        { venueId: "d", pubName: "New July Pub", boroughCode: "brent", boroughName: "Brent", pricePence: 480, observedAt: "2026-07-20T12:00:00.000Z", sourceId: "drop-2" },
      ],
    }));
    expect(after.observations).toEqual(before.observations);
    expect(after.archive.observationsSha256).toBe(before.archive.observationsSha256);
  });

  it("hashes what an observation MEANS, not how the file is arranged", () => {
    const edition = freeze();
    const reordered = freeze(live({ observations: [...live().observations].reverse() }));
    expect(reordered.archive.observationsSha256).toBe(edition.archive.observationsSha256);

    const repriced = freeze(live({
      observations: live().observations.map((row) =>
        row.venueId === "a" ? { ...row, pricePence: 521 } : row),
    }));
    expect(repriced.archive.observationsSha256).not.toBe(edition.archive.observationsSha256);
  });

  it("refuses to freeze a month that is still filling, or one the index never saw", () => {
    const snapshot = live();
    expect(monthPublishBlocker("2026-06", snapshot, new Date("2026-07-27T00:00:00Z"))).toBeNull();
    expect(monthPublishBlocker("2026-07", snapshot, new Date("2026-07-27T00:00:00Z")))
      .toBe("2026-07 has not closed yet");
    expect(monthPublishBlocker("2026-08", snapshot, new Date("2026-10-01T00:00:00Z")))
      .toBe("2026-08 closes after the live index was generated");
    expect(monthPublishBlocker("2026-06", live({
      observationWindow: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-15T23:59:59.000Z" },
    }), new Date("2026-07-27T00:00:00Z")))
      .toBe("2026-06 ends before the live index starts covering prices");
    expect(monthPublishBlocker("2026-6", snapshot, new Date("2026-07-27T00:00:00Z")))
      .toBe("2026-6 is not a YYYY-MM month");
  });

  it("asks the live snapshot about a first publication only, never about a correction", () => {
    // Once the live window advances past a published month, that month can
    // still be corrected: a frozen figure nobody can fix is worse than a
    // correction the reader can see.
    const advanced = live({
      generatedAt: "2027-01-16T00:00:00.000Z",
      observationWindow: { start: "2026-12-01T00:00:00.000Z", end: "2027-01-15T23:59:59.000Z" },
    });
    const now = new Date("2027-01-20T00:00:00Z");
    expect(monthPublishBlocker("2026-06", advanced, now))
      .toBe("2026-06 ends before the live index starts covering prices");
    expect(monthPublishFloorBlocker("2026-06", now)).toBeNull();
  });

  it("refuses a month that predates the public Index, with or without a coverage window", () => {
    // The shipped snapshot carries no observationWindow until something
    // qualifies, so the coverage check cannot be the floor. Without a declared
    // start, a long-past month would freeze into a zero-observation edition
    // that reads as a finding about a window nobody ever looked at.
    const unassessed = live({ status: "empty", observationWindow: null, observations: [], sources: [] });
    const now = new Date("2026-07-27T00:00:00Z");
    const refused = `2019-03 is before the public Index began covering prices in ${PINT_INDEX_PUBLIC_START_MONTH}`;
    expect(monthPublishBlocker("2019-03", unassessed, now)).toBe(refused);
    // And it stays refused on the floor alone, which is the only check a
    // correction faces, so no correction can smuggle one in either.
    expect(monthPublishFloorBlocker("2019-03", now)).toBe(refused);
    // A genuinely assessed month with nothing qualifying in it still publishes.
    expect(monthPublishBlocker(PINT_INDEX_PUBLIC_START_MONTH, unassessed, now)).toBeNull();
  });

  it("refuses a month that starts after the live index stopped covering prices", () => {
    const stale = live({
      generatedAt: "2026-10-01T00:00:00.000Z",
      observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-15T23:59:59.000Z" },
    });
    expect(monthPublishBlocker("2026-08", stale, new Date("2026-10-02T00:00:00Z")))
      .toBe("2026-08 starts after the live index stops covering prices");
  });

  it("names the month currently filling on the London calendar, not the UTC one", () => {
    // 00:30 on 1 August in London is still 31 July in UTC during BST.
    expect(londonMonthOf(new Date("2026-07-31T23:30:00.000Z"))).toBe("2026-08");
    expect(londonMonthOf(new Date("2026-08-01T00:30:00.000Z"))).toBe("2026-08");
    expect(londonMonthOf(new Date("2026-01-31T23:30:00.000Z"))).toBe("2026-01");
  });

  it("publishes a month once, then only as a named correction that changes something", () => {
    const first = planArchivePublish({ existing: null, rebuilt: freeze(), issuedAt: "2026-07-01T09:00:00.000Z", sha256 });
    expect(first).toMatchObject({ ok: true, kind: "first" });
    if (!first.ok) throw new Error("unreachable");

    const silent = planArchivePublish({
      existing: first.archive,
      rebuilt: freeze(live({ observations: live().observations.slice(1) })),
      issuedAt: "2026-08-01T09:00:00.000Z",
      sha256,
    });
    expect(silent).toEqual({
      ok: false,
      reason: "2026-06 is already published. A published month only changes as a named correction.",
    });

    const noop = planArchivePublish({
      existing: first.archive,
      rebuilt: freeze(),
      correctionNote: "Tidying.",
      issuedAt: "2026-08-01T09:00:00.000Z",
      sha256,
    });
    expect(noop).toEqual({ ok: false, reason: "2026-06 would not change, so there is nothing to correct" });
  });

  it("records a correction as an append, carrying the hash of what it replaced", () => {
    const published = freeze();
    const corrected = planArchivePublish({
      existing: published,
      rebuilt: freeze(live({
        observations: live().observations.filter((row) => row.venueId !== "b"),
      })),
      correctionNote: "Also June cited a menu page that never carried that price.",
      issuedAt: "2026-08-02T10:00:00.000Z",
      sha256,
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) throw new Error("unreachable");
    expect(corrected.archive.archive.revision).toBe(2);
    expect(corrected.archive.archive.corrections).toEqual([{
      issuedAt: "2026-08-02T10:00:00.000Z",
      note: "Also June cited a menu page that never carried that price.",
      previousRevision: 1,
      previousObservationsSha256: published.archive.observationsSha256,
    }]);
    expect(validateArchivedPintIndexSnapshot(corrected.archive, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  it("corrects a published month out of its own edition, never out of a snapshot that moved on", () => {
    const published = freeze();
    expect(published.observations.map((row) => row.venueId)).toEqual(["a", "b"]);

    // Months later the live index covers a different window entirely, so a
    // rebuild would hand back nothing at all. That silence is absence, not a
    // finding about June, and a note about one wrong price must never be the
    // thing that withdraws every price in the edition.
    const movedOn = live({
      status: "empty",
      generatedAt: "2027-01-16T00:00:00.000Z",
      observationWindow: { start: "2026-12-01T00:00:00.000Z", end: "2027-01-15T23:59:59.000Z" },
      observations: [],
      sources: [],
    });
    expect(buildArchivedMonth({
      snapshot: movedOn, month: "2026-06", publishedAt: "2027-01-20T09:00:00.000Z", sha256,
    }).observations).toEqual([]);

    const amended = amendArchivedMonth({ edition: published, withdraw: [{ venueId: "b" }], sha256 });
    if (!amended.ok) throw new Error(amended.reason);
    expect(amended.archive.observations.map((row) => row.venueId)).toEqual(["a"]);

    const corrected = planArchivePublish({
      existing: published,
      rebuilt: amended.archive,
      correctionNote: "Also June cited a menu page that never carried that price.",
      issuedAt: "2027-01-20T09:00:00.000Z",
      sha256,
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) throw new Error("unreachable");
    expect(corrected.archive.observations.map((row) => row.venueId)).toEqual(["a"]);
    expect(corrected.archive.archive.revision).toBe(2);
    expect(corrected.archive.archive.corrections[0].previousObservationsSha256)
      .toBe(published.archive.observationsSha256);
    expect(validateArchivedPintIndexSnapshot(corrected.archive, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  it("refuses to withdraw a price the edition never published", () => {
    expect(amendArchivedMonth({ edition: freeze(), withdraw: [{ venueId: "nope" }], sha256 })).toEqual({
      ok: false,
      reason: "2026-06 publishes no observation for nope, so there is nothing to withdraw",
    });
  });

  it("leaves a valid empty edition when every price in it is withdrawn", () => {
    const amended = amendArchivedMonth({
      edition: freeze(),
      withdraw: [{ venueId: "a" }, { venueId: "b" }],
      sha256,
    });
    if (!amended.ok) throw new Error(amended.reason);
    expect(amended.archive.status).toBe("empty");
    expect(amended.archive.observations).toEqual([]);
    // The source only that withdrawn price cited leaves with it.
    expect(amended.archive.sources).toEqual([]);
    expect(validateArchivedPintIndexSnapshot(amended.archive, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  // One pub, two prices in the same month. The league table already keeps the
  // latest per venue, so this is an ordinary edition, not a malformed one.
  const twoPricesOnePub = () => freeze(live({
    observations: [
      { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 520, observedAt: "2026-06-04T18:00:00.000Z", sourceId: "drop-1" },
      { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 560, observedAt: "2026-06-20T18:00:00.000Z", sourceId: "drop-2" },
    ],
  }));

  it("withdraws the price a correction names, not every price the pub has", () => {
    const edition = twoPricesOnePub();
    const amended = amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-20T18:00:00.000Z" }],
      sha256,
    });
    if (!amended.ok) throw new Error(amended.reason);
    expect(amended.archive.observations).toEqual([edition.observations[0]]);
    // The Crown keeps its 4 June price and its place in Camden's count.
    expect(amended.archive.sources.map((source) => source.id)).toEqual(["drop-1"]);
    expect(validateArchivedPintIndexSnapshot(amended.archive, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  it("refuses a venue-wide amendment when the month holds more than one price for it", () => {
    expect(amendArchivedMonth({ edition: twoPricesOnePub(), withdraw: [{ venueId: "crown-camden" }], sha256 })).toEqual({
      ok: false,
      reason: "2026-06 publishes 2 observations for crown-camden (2026-06-04T18:00:00.000Z, 2026-06-20T18:00:00.000Z), so name the one to withdraw by its observed-at date",
    });
  });

  it("restates a mis-transcribed price rather than deleting the evidence", () => {
    const edition = twoPricesOnePub();
    const amended = amendArchivedMonth({
      edition,
      restate: [{ venueId: "crown-camden", observedAt: "2026-06-20T18:00:00.000Z", pricePence: 560 }],
      sha256,
    });
    // Same figure, so nothing to correct.
    expect(amended).toEqual({
      ok: false,
      reason: "crown-camden at 2026-06-20T18:00:00.000Z already publishes 560p",
    });

    const fixed = amendArchivedMonth({
      edition,
      restate: [{ venueId: "crown-camden", observedAt: "2026-06-20T18:00:00.000Z", pricePence: 506 }],
      sha256,
    });
    if (!fixed.ok) throw new Error(fixed.reason);
    expect(fixed.archive.observations.map((row) => row.pricePence)).toEqual([520, 506]);
    expect(fixed.archive.observations).toHaveLength(edition.observations.length);
    expect(fixed.archive.archive.observationsSha256).not.toBe(edition.archive.observationsSha256);
    expect(validateArchivedPintIndexSnapshot(fixed.archive, { month: "2026-06", sha256 }).ok).toBe(true);

    const corrected = planArchivePublish({
      existing: edition,
      rebuilt: fixed.archive,
      correctionNote: "The Crown's 20 June price was transcribed as 5.60; the menu says 5.06.",
      issuedAt: "2026-08-02T10:00:00.000Z",
      sha256,
    });
    if (!corrected.ok) throw new Error("unreachable");
    expect(corrected.archive.archive.revision).toBe(2);
    expect(corrected.archive.archive.corrections[0].previousObservationsSha256)
      .toBe(edition.archive.observationsSha256);
  });

  it("refuses an amendment that names no single observation or no real price", () => {
    const edition = twoPricesOnePub();
    expect(amendArchivedMonth({
      edition,
      restate: [{ venueId: "crown-camden", observedAt: "2026-06-11T00:00:00.000Z", pricePence: 506 }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "2026-06 publishes no observation for crown-camden at 2026-06-11T00:00:00.000Z (it holds 2026-06-04T18:00:00.000Z, 2026-06-20T18:00:00.000Z), so there is nothing to restate",
    });
    expect(amendArchivedMonth({
      edition,
      restate: [{ venueId: "crown-camden", observedAt: "2026-06-04T18:00:00.000Z", pricePence: 0 }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "restating crown-camden at 2026-06-04T18:00:00.000Z needs a positive whole number of pence",
    });
    expect(amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-04T18:00:00.000Z" }],
      restate: [{ venueId: "crown-camden", observedAt: "2026-06-04T18:00:00.000Z", pricePence: 506 }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "2026-06 amends crown-camden at 2026-06-04T18:00:00.000Z twice",
    });
  });

  // Two prices for one pub on the SAME instant. Reachable because an
  // observed-at may be a bare date, so an open-data lane stamping the day
  // collides exactly. Refusing is right; leaving no way to say which one would
  // make a published wrong price uncorrectable.
  const samePubSameInstant = () => freeze(live({
    observations: [
      { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 520, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
      { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 560, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-2" },
    ],
  }));

  it("asks for the source id when two prices share an instant, and takes it", () => {
    const edition = samePubSameInstant();
    expect(amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-04T00:00:00.000Z" }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "2026-06 publishes 2 observations for crown-camden at 2026-06-04T00:00:00.000Z (citing drop-1, drop-2), so name the one to withdraw by its source id",
    });

    const amended = amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-2" }],
      sha256,
    });
    if (!amended.ok) throw new Error(amended.reason);
    expect(amended.archive.observations).toEqual([edition.observations[0]]);
    expect(validateArchivedPintIndexSnapshot(amended.archive, { month: "2026-06", sha256 }).ok).toBe(true);
  });

  it("falls back to an ordinal when nothing else tells two observations apart", () => {
    const edition = freeze(live({
      observations: [
        { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 520, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
        { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden", pricePence: 560, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
      ],
    }));
    expect(amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "2026-06 publishes 2 observations for crown-camden that these fields cannot tell apart, so name the one to withdraw by its ordinal, 1 to 2 in published order",
    });

    const amended = amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1", ordinal: 2 }],
      sha256,
    });
    if (!amended.ok) throw new Error(amended.reason);
    expect(amended.archive.observations.map((row) => row.pricePence)).toEqual([520]);

    expect(amendArchivedMonth({
      edition,
      withdraw: [{ venueId: "crown-camden", ordinal: 3 }],
      sha256,
    })).toEqual({
      ok: false,
      reason: "2026-06 leaves 2 observations for crown-camden to choose from, so the ordinal must be a whole number between 1 and 2",
    });
  });

  it("rejects an edition whose observations no longer match its published hash", () => {
    const edition = freeze();
    const rewritten = {
      ...edition,
      observations: edition.observations.map((row) =>
        row.venueId === "a" ? { ...row, pricePence: 399 } : row),
    };
    const result = validateArchivedPintIndexSnapshot(rewritten, { month: "2026-06", sha256 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toContain("archive.observationsSha256 does not match the published observations");
  });

  it("rejects an edition that drifts from the window, the month, or its correction chain", () => {
    const edition = freeze();
    const errorsFor = (value: unknown, month = "2026-06") => {
      const result = validateArchivedPintIndexSnapshot(value, { month, sha256 });
      return result.ok ? [] : result.errors;
    };

    expect(errorsFor(edition, "2026-05")).toContain(
      "archive.month 2026-06 does not match the edition it is stored as (2026-05)",
    );
    expect(errorsFor({
      ...edition,
      observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
    })).toContain("observationWindow must be exactly the archived month");
    expect(errorsFor({
      ...edition,
      archive: { ...edition.archive, revision: 2 },
    })).toContain("archive.revision must equal the number of corrections plus one");
    expect(errorsFor({
      ...edition,
      archive: {
        ...edition.archive,
        revision: 2,
        corrections: [{ issuedAt: "2026-08-02T10:00:00.000Z", note: "  ", previousRevision: 1, previousObservationsSha256: "nope" }],
      },
    })).toEqual(expect.arrayContaining([
      "correction 0 needs a note",
      "correction 0 must carry the replaced revision's observations hash",
    ]));
    expect(errorsFor({ ...edition, archive: undefined })).toContain("archive metadata is missing");
  });
});

describe("the canonical form the integrity hash covers", () => {
  const rows = [
    { venueId: "crown-camden", pubName: "The Crown", boroughCode: "camden", boroughName: "Camden" as const, pricePence: 520, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
    { venueId: "crown", pubName: "Crown", boroughCode: "camden", boroughName: "Camden" as const, pricePence: 530, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
    { venueId: "crowna", pubName: "Crowna", boroughCode: "camden", boroughName: "Camden" as const, pricePence: 540, observedAt: "2026-06-04T00:00:00.000Z", sourceId: "drop-1" },
  ];

  it("is ONE implementation, which the build gate imports rather than restates", () => {
    // Two hand-kept copies agree until they do not, and the failure they
    // produce reads as "someone rewrote a citation" against an edition nobody
    // touched. So validate-data must import the reduction, not carry its own.
    const gate = readFileSync(path.join(process.cwd(), "scripts/validate-data.mjs"), "utf8");
    expect(gate).toContain('from "../lib/pintIndexCanonical.mjs"');
    expect(gate).not.toMatch(/\.sort\(\(a, b\) => a\.join\(/);
    expect(canonicalObservationsPayload(rows)).toBe(canonicalPayload(rows));
  });

  it("orders prefix-related venue ids by code unit, so no locale can restate a digest", () => {
    // The separator is part of the sort key, which is exactly where a space
    // and a NUL disagree, and localeCompare's answer moves with the ICU build
    // under a file that has to hash the same for years.
    expect(JSON.parse(canonicalObservationsPayload(rows)).map((row: string[]) => row[0]))
      .toEqual(["crown", "crown-camden", "crowna"]);
  });

  it("carries no raw NUL byte in its sources, so both files stay readable text", () => {
    for (const file of ["lib/pintIndexArchive.ts", "lib/pintIndexCanonical.mjs", "scripts/validate-data.mjs"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toContain("\u0000");
    }
  });
});

describe("the editions actually published in this repo", () => {
  const dir = path.join(process.cwd(), "public/data/pint_index");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

  it("publishes at least one dated edition", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s holds its own contract and its integrity hash", (file) => {
    const month = file.slice(0, -".json".length);
    const stored = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown;
    const result = validateArchivedPintIndexSnapshot(stored, { month, sha256 });
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  // Only the properties of a published month that can never stop being true.
  // Asserting anything the live snapshot decides would put a moving fence
  // around a file the write-once contract forbids rewriting or deleting.
  it.each(files)("%s is a closed month the public Index existed to assess", (file) => {
    const month = file.slice(0, -".json".length);
    expect(month >= PINT_INDEX_PUBLIC_START_MONTH).toBe(true);
    expect(monthPublishFloorBlocker(month, new Date())).toBeNull();
  });

  it.each(files)("%s reads as a closed month, never a live page", (file) => {
    const stored = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as ArchivedPintIndexSnapshot;
    const month = file.slice(0, -".json".length);
    expect(Date.parse(pintIndexMonthWindow(month).end)).toBeLessThan(Date.parse(stored.archive.publishedAt));
  });
});
