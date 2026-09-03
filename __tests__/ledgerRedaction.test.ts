import { describe, expect, it } from "vitest";

// F4: public-page redaction for the Family Table (legacy / ledger-only drops).
// The public /ledger/[id] page must not render a legacy drop's full handle,
// price, or note body — redactFamilyTableEntries is the pure seam it renders
// through. True viewer-gating waits for Supabase Auth; this pins the redaction.
import {
  buildFamilyTableEntries,
  buildLedgerEntries,
  isFamilyTableOwner,
  REDACTED_ANON_LABEL,
  redactFamilyTableEntries,
  redactHandle,
  resolveFamilyTableDisplay,
  type LedgerSourceDrop,
} from "@/lib/ledger";

function isFullFamilyEntry(
  entry: ReturnType<typeof resolveFamilyTableDisplay>[number],
): entry is ReturnType<typeof buildFamilyTableEntries>[number] {
  return "note" in entry;
}

function makeDrop(overrides: Partial<LedgerSourceDrop> = {}): LedgerSourceDrop {
  return {
    id: "drop-1",
    handle: "@karan_m",
    drink: "Stout",
    priceGbp: 6.1,
    passedDownNote: "Grandad's corner seat, every Friday since '74.",
    era: "1970s",
    provenance: "anecdote",
    createdAt: "2024-06-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("redactHandle (initials-style, deterministic)", () => {
  it("turns underscore-separated handles into initials", () => {
    expect(redactHandle("@karan_m")).toBe("K. M.");
    expect(redactHandle("wapping_wall_ted")).toBe("W. W. T.");
  });

  it("handles a single-segment handle", () => {
    expect(redactHandle("@alebrarian")).toBe("A.");
  });

  it("is deterministic and never echoes the handle back", () => {
    expect(redactHandle("@karan_m")).toBe(redactHandle("karan_m"));
    expect(redactHandle("@karan_m")).not.toContain("karan");
  });

  it("normalises before redacting (case, stray @s, illegal chars)", () => {
    expect(redactHandle("@@Karan_M!")).toBe("K. M.");
  });

  it("falls back to the anonymous label for empty/nullish handles", () => {
    expect(redactHandle("")).toBe(REDACTED_ANON_LABEL);
    expect(redactHandle(null)).toBe(REDACTED_ANON_LABEL);
    expect(redactHandle(undefined)).toBe(REDACTED_ANON_LABEL);
    expect(redactHandle("@@@")).toBe(REDACTED_ANON_LABEL);
  });
});

describe("redactFamilyTableEntries (public Family Table)", () => {
  it("redacts the handle and OMITS price and note entirely", () => {
    const entries = buildFamilyTableEntries([makeDrop()]);
    const [redacted] = redactFamilyTableEntries(entries);

    expect(redacted.handle).toBe("K. M.");
    // Omitted at the object level, not just nulled — the keys must be gone so
    // no render site can reach the private fields.
    expect("note" in redacted).toBe(false);
    expect("priceLabel" in redacted).toBe(false);
    const blob = JSON.stringify(redacted);
    expect(blob).not.toContain("Grandad");
    expect(blob).not.toContain("6.1");
    expect(blob).not.toContain("karan");
  });

  it("keeps date, era, and provenance (venue-level colour survives)", () => {
    const [redacted] = redactFamilyTableEntries(buildFamilyTableEntries([makeDrop()]));
    expect(redacted.id).toBe("drop-1");
    expect(redacted.dateLabel).toBe("3 June 2024");
    expect(redacted.createdAt).toBe("2024-06-03T12:00:00.000Z");
    expect(redacted.era).toBe("1970s");
    expect(redacted.provenance).toBe("anecdote");
  });

  it("preserves order and count (the table keeps its shape)", () => {
    const entries = buildFamilyTableEntries([
      makeDrop({ id: "old", createdAt: "2023-01-01T00:00:00.000Z", handle: "@old_hand" }),
      makeDrop({ id: "new", createdAt: "2025-01-01T00:00:00.000Z", handle: "@new_face" }),
    ]);
    const redacted = redactFamilyTableEntries(entries);
    expect(redacted.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    expect(redacted).toHaveLength(2);
  });

  it("redacts a priced-but-noteless entry's fallback note too (price never leaks)", () => {
    // toLedgerEntry synthesises "Logged <drink> at <price>." for a priced,
    // noteless drop — that fallback carries the price, so it must go as well.
    const entries = buildFamilyTableEntries([makeDrop({ passedDownNote: "" })]);
    expect(entries).toHaveLength(1); // sanity: it survives composition
    const blob = JSON.stringify(redactFamilyTableEntries(entries));
    expect(blob).not.toContain("6.1");
    expect(blob).not.toContain("Logged");
  });

  it("does NOT touch the public logbook builder — only ledger-only entries are redacted", () => {
    // buildLedgerEntries feeds the public logbook lane (public/anonymous
    // drops), which legitimately shows handle, note, and price.
    const [entry] = buildLedgerEntries([makeDrop()]);
    expect(entry.handle).toBe("@karan_m");
    expect(entry.note).toContain("Grandad");
    expect(entry.priceLabel).toBe("£6.10");
  });
});

describe("resolveFamilyTableDisplay (viewer-aware ledger privacy)", () => {
  const sources = [
    makeDrop({ id: "legacy-1", handle: "@karan_m" }),
    makeDrop({ id: "legacy-2", handle: "@other_hand", passedDownNote: "Secret family lore." }),
  ];
  const entries = buildFamilyTableEntries(sources);

  it("redacts every entry when no viewer is supplied", () => {
    const display = resolveFamilyTableDisplay(entries, sources);
    expect(display).toHaveLength(2);
    for (const row of display) {
      expect("note" in row).toBe(false);
    }
    expect(display[0].handle).toBe("K. M.");
  });

  it("shows the full entry to the drop author via ?viewer=", () => {
    const display = resolveFamilyTableDisplay(entries, sources, "karan_m");
    const mine = display[0];
    const theirs = display[1];
    expect(isFullFamilyEntry(mine)).toBe(true);
    if (isFullFamilyEntry(mine)) expect(mine.note).toContain("Grandad");
    expect(isFullFamilyEntry(theirs)).toBe(false);
  });

  it("isFamilyTableOwner matches normalised handles only", () => {
    expect(isFamilyTableOwner("@karan_m", "karan_m")).toBe(true);
    expect(isFamilyTableOwner("karan_m", "@Karan_M")).toBe(true);
    expect(isFamilyTableOwner("@karan_m", "other")).toBe(false);
    expect(isFamilyTableOwner("", null)).toBe(false);
  });
});
