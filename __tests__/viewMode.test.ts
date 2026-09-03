import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODE,
  MODE_DEFAULT_LANE,
  modeEnablesLegacy,
  parseMode,
  resolveMode,
  venueHrefForMode,
} from "@/lib/viewMode";

describe("parseMode", () => {
  it("accepts the two known modes and rejects everything else", () => {
    expect(parseMode("lock-in")).toBe("lock-in");
    expect(parseMode("ledger")).toBe("ledger");
    expect(parseMode("heritage")).toBeNull();
    expect(parseMode("")).toBeNull();
    expect(parseMode(null)).toBeNull();
    expect(parseMode(undefined)).toBeNull();
    expect(parseMode(1)).toBeNull();
  });
});

describe("resolveMode", () => {
  it("defaults to Lock-In when nothing is stored", () => {
    expect(resolveMode(null, null)).toBe(DEFAULT_MODE);
  });

  it("honours an explicit stored mode over everything", () => {
    expect(resolveMode("ledger", null)).toBe("ledger");
    expect(resolveMode("lock-in", "1")).toBe("lock-in");
    // Explicit Lock-In wins even if a stale legacy flag says otherwise.
    expect(resolveMode("lock-in", "1")).not.toBe("ledger");
  });

  it("falls back to Ledger when only the legacy flag is on", () => {
    // A user who enabled Legacy Mode directly is, in spirit, in Ledger.
    expect(resolveMode(null, "1")).toBe("ledger");
    expect(resolveMode(null, "0")).toBe("lock-in");
  });

  it("ignores an unrecognised stored mode string", () => {
    expect(resolveMode("bogus", "1")).toBe("ledger");
    expect(resolveMode("bogus", null)).toBe("lock-in");
  });
});

describe("modeEnablesLegacy", () => {
  it("only Ledger drives the legacy flag", () => {
    expect(modeEnablesLegacy("ledger")).toBe(true);
    expect(modeEnablesLegacy("lock-in")).toBe(false);
  });
});

describe("MODE_DEFAULT_LANE", () => {
  it("opens both modes on the complete chronological lane", () => {
    expect(MODE_DEFAULT_LANE["lock-in"]).toBe("latest");
    expect(MODE_DEFAULT_LANE.ledger).toBe("latest");
  });
});

describe("venueHrefForMode", () => {
  const links = { map: "/map?venue=abc", ledger: "/ledger/abc" };

  it("Ledger prefers the logbook when a ledger peer exists", () => {
    expect(venueHrefForMode("ledger", links)).toBe("/ledger/abc");
  });

  it("Lock-In always keeps the map link", () => {
    expect(venueHrefForMode("lock-in", links)).toBe("/map?venue=abc");
  });

  it("falls back to the map link in Ledger when no logbook peer exists", () => {
    expect(venueHrefForMode("ledger", { map: "/map?venue=abc" })).toBe(
      "/map?venue=abc",
    );
  });
});
