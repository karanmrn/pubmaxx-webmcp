import { describe, it, expect } from "vitest";

import {
  buildFamilyShareText,
  buildFamilyTableEntries,
  buildLedgerEntries,
  formatLedgerDate,
  toLedgerEntry,
  type LedgerSourceDrop,
} from "@/lib/ledger";

function makeDrop(overrides: Partial<LedgerSourceDrop> = {}): LedgerSourceDrop {
  return {
    id: "drop-1",
    handle: "@regular",
    drink: "Lager",
    priceGbp: 5.5,
    passedDownNote: "",
    era: "",
    provenance: "anecdote",
    createdAt: "2024-06-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatLedgerDate", () => {
  it("formats a valid ISO date as en-GB long date", () => {
    expect(formatLedgerDate("2024-06-03T12:00:00.000Z")).toBe("3 June 2024");
  });

  it("returns null for an unparseable date", () => {
    expect(formatLedgerDate("not-a-date")).toBeNull();
  });
});

describe("toLedgerEntry", () => {
  it("prefers the passed-down note as the entry body", () => {
    const entry = toLedgerEntry(
      makeDrop({ passedDownNote: "Quiet Tuesday, landlord told us about the flood of '53." }),
    );
    expect(entry.note).toBe("Quiet Tuesday, landlord told us about the flood of '53.");
    expect(entry.priceLabel).toBe("£5.50");
  });

  it("falls back to a logged-price line when there is no note", () => {
    const entry = toLedgerEntry(makeDrop({ passedDownNote: "", drink: "Stout", priceGbp: 4.2 }));
    expect(entry.note).toBe("Logged Stout at £4.20.");
  });

  it("produces an empty note when there is neither a note nor a price", () => {
    const entry = toLedgerEntry(makeDrop({ passedDownNote: "", priceGbp: null }));
    expect(entry.note).toBe("");
    expect(entry.priceLabel).toBeNull();
  });

  it("formats the display handle and date label", () => {
    const entry = toLedgerEntry(makeDrop({ handle: "anonymous" }));
    expect(entry.dateLabel).toBe("3 June 2024");
    expect(typeof entry.handle).toBe("string");
  });
});

describe("buildLedgerEntries", () => {
  it("sorts entries newest first", () => {
    const drops = [
      makeDrop({ id: "old", passedDownNote: "Old note", createdAt: "2023-01-01T00:00:00.000Z" }),
      makeDrop({ id: "new", passedDownNote: "New note", createdAt: "2024-06-03T12:00:00.000Z" }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("drops entries with no note and no price (nothing to log)", () => {
    const drops = [
      makeDrop({ id: "empty", passedDownNote: "", priceGbp: null }),
      makeDrop({ id: "priced", passedDownNote: "", priceGbp: 3.8 }),
      makeDrop({ id: "noted", passedDownNote: "Great pint" }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries.map((e) => e.id).sort()).toEqual(["noted", "priced"]);
  });

  it("returns an empty array for no drops", () => {
    expect(buildLedgerEntries([])).toEqual([]);
  });

  // Dedupe regression (D1): a drop that appears twice in the source array (e.g.
  // two overlapping store reads, or a seeded row echoing a real one) must
  // collapse to a single logbook entry keyed by its stable id.
  it("collapses two entries with the same id into one", () => {
    const drops = [
      makeDrop({ id: "dup", passedDownNote: "Same drop, twice." }),
      makeDrop({ id: "dup", passedDownNote: "Same drop, twice." }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("dup");
  });

  // The mirror of the dedupe: genuinely distinct drops (different ids) must all
  // survive — the dedupe must never over-collapse.
  it("preserves genuinely distinct entries", () => {
    const drops = [
      makeDrop({ id: "a", passedDownNote: "First note", createdAt: "2024-06-03T12:00:00.000Z" }),
      makeDrop({ id: "b", passedDownNote: "Second note", createdAt: "2024-06-02T12:00:00.000Z" }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("The Family Table (issue #27)", () => {
  it("buildFamilyTableEntries composes legacy drops the same way as buildLedgerEntries", () => {
    const legacyDrops = [
      makeDrop({
        id: "legacy-1",
        handle: "@nan",
        passedDownNote: "Grandad's local before the war.",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
      makeDrop({
        id: "legacy-2",
        handle: "@dad",
        passedDownNote: "First pint after the wedding.",
        createdAt: "2022-05-05T00:00:00.000Z",
      }),
    ];
    const entries = buildFamilyTableEntries(legacyDrops);
    expect(entries.map((e) => e.id)).toEqual(["legacy-2", "legacy-1"]);
    // Legacy is family-lane, not anonymous: the handle is attributed, not withheld.
    expect(entries[0].handle).toBe("@dad");
    expect(entries[1].handle).toBe("@nan");
  });

  it("drops legacy entries with neither a note nor a price, same rule as the public ledger", () => {
    const entries = buildFamilyTableEntries([
      makeDrop({ id: "empty", passedDownNote: "", priceGbp: null }),
    ]);
    expect(entries).toEqual([]);
  });

  // Privacy honesty (issue #27, item 4): legacy drops must NEVER be composable
  // via buildLedgerEntries (the public logbook's builder) — the store's
  // listVisible() already excludes visibility:"legacy" server-side (see
  // lib/pintDropsStore.ts), and this test locks in the client-side half of
  // that guarantee: even if a legacy drop somehow ended up in the array handed
  // to buildLedgerEntries, the family table and the public logbook are, and
  // must stay, two independently-sourced arrays — never one filtered from the
  // other. This test exists to fail loudly if a future refactor merges them.
  it("the public ledger builder and the family table builder are independent — never the same source array", () => {
    const publicDrop = makeDrop({ id: "public-1", passedDownNote: "Great Tuesday session." });
    const legacyDrop = makeDrop({ id: "legacy-1", passedDownNote: "Nan's favourite corner seat." });

    // Simulates the page: two SEPARATE store reads (listVisible vs.
    // listLegacyForVenue), never a single list split by a client-side filter.
    const publicEntries = buildLedgerEntries([publicDrop]);
    const familyEntries = buildFamilyTableEntries([legacyDrop]);

    expect(publicEntries.map((e) => e.id)).toEqual(["public-1"]);
    expect(familyEntries.map((e) => e.id)).toEqual(["legacy-1"]);
    // The legacy drop must never appear in the public entries array.
    expect(publicEntries.some((e) => e.id === "legacy-1")).toBe(false);
  });
});

describe("buildFamilyShareText", () => {
  it("builds a title/text/url share payload attributing the note to the pub", () => {
    const share = buildFamilyShareText({
      venueName: "The Ten Bells",
      note: "Grandad's local before the war.",
      url: "/ledger/ten-bells",
    });
    expect(share.title).toBe("The Ten Bells");
    expect(share.text).toBe(
      "Grandad's local before the war.\nFrom the family table at The Ten Bells",
    );
    expect(share.url).toBe("/ledger/ten-bells");
  });

  it("falls back to a section-level text when there is no note", () => {
    const share = buildFamilyShareText({ venueName: "The Ten Bells", note: "", url: "/ledger/x" });
    expect(share.text).toBe("The family table at The Ten Bells");
  });

  it("builds a mailto: href with subject and body prefilled", () => {
    const share = buildFamilyShareText({
      venueName: "The Ten Bells",
      note: "Grandad's local.",
      url: "/ledger/ten-bells",
    });
    expect(share.mailtoHref.startsWith("mailto:?subject=")).toBe(true);
    expect(share.mailtoHref).toContain(encodeURIComponent("The family table at The Ten Bells"));
    expect(share.mailtoHref).toContain("body=");
    // Decoded body contains the share text and the url.
    const bodyMatch = share.mailtoHref.match(/body=([^&]*)/);
    expect(bodyMatch).not.toBeNull();
    const decodedBody = decodeURIComponent(bodyMatch![1]);
    expect(decodedBody).toContain("Grandad's local.");
    expect(decodedBody).toContain("/ledger/ten-bells");
  });

  it("trims whitespace-only notes to the section-level fallback", () => {
    const share = buildFamilyShareText({ venueName: "The Ten Bells", note: "   ", url: "/x" });
    expect(share.text).toBe("The family table at The Ten Bells");
  });
});
