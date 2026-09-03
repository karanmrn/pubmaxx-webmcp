import { describe, expect, it } from "vitest";

import {
  activeCheckIns,
  CHECK_IN_TTL_MS,
  DEFAULT_CHECK_IN_VISIBILITY,
  expiresAtIso,
  isExpired,
  validateCheckInInput,
  type CheckIn,
} from "@/lib/checkIn";

describe("validateCheckInInput", () => {
  it("accepts a valid friends-only check-in and normalises the handle", () => {
    const result = validateCheckInInput({ handle: "  Karan ", areaSlug: "shoreditch" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handle).toBe("karan");
    expect(result.value.areaSlug).toBe("shoreditch");
    expect(result.value.visibility).toBe(DEFAULT_CHECK_IN_VISIBILITY);
    expect(result.value.venueId).toBeNull();
    expect(result.value.note).toBeNull();
  });

  it("rejects a missing handle", () => {
    const result = validateCheckInInput({ areaSlug: "shoreditch" });
    expect(result).toEqual({
      ok: false,
      error: "Choose a handle in your account first.",
    });
  });

  it("accepts an absent/empty area as a plain 'out tonight' signal (areaSlug: null)", () => {
    const noField = validateCheckInInput({ handle: "karan" });
    expect(noField.ok).toBe(true);
    if (noField.ok) expect(noField.value.areaSlug).toBeNull();

    const blank = validateCheckInInput({ handle: "karan", areaSlug: "" });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value.areaSlug).toBeNull();

    const whitespace = validateCheckInInput({ handle: "karan", areaSlug: "   " });
    expect(whitespace.ok).toBe(true);
    if (whitespace.ok) expect(whitespace.value.areaSlug).toBeNull();
  });

  it("rejects an unknown, non-empty area (never coerces a bad slug)", () => {
    const result = validateCheckInInput({ handle: "karan", areaSlug: "atlantis" });
    expect(result.ok).toBe(false);
  });

  it("keeps an explicit venue tag and cleans the note", () => {
    const result = validateCheckInInput({
      handle: "karan",
      areaSlug: "brixton",
      venueId: "venue-abc",
      note: "garden's <b>rammed</b>",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.venueId).toBe("venue-abc");
    // cleanText strips inline angle brackets.
    expect(result.value.note).not.toContain("<");
    expect(result.value.note).toContain("rammed");
  });

  it("honours an allowlisted 'area' visibility but falls back to friends for junk", () => {
    const areaVis = validateCheckInInput({ handle: "k", areaSlug: "camden", visibility: "area" });
    expect(areaVis.ok && areaVis.value.visibility).toBe("area");
    const junk = validateCheckInInput({ handle: "k", areaSlug: "camden", visibility: "public" });
    expect(junk.ok && junk.value.visibility).toBe("friends");
  });

  it("has no coordinate fields in the normalised shape (area-level only)", () => {
    const result = validateCheckInInput({ handle: "k", areaSlug: "camden" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(
      expect.not.arrayContaining(["lat", "lng", "latitude", "longitude", "coords"]),
    );
  });
});

describe("expiry", () => {
  it("stamps expiry 12h after creation", () => {
    const created = "2026-07-18T20:00:00.000Z";
    const expires = expiresAtIso(created);
    expect(Date.parse(expires) - Date.parse(created)).toBe(CHECK_IN_TTL_MS);
  });

  it("marks a check-in expired only after its expiry", () => {
    const check: Pick<CheckIn, "expiresAt"> = { expiresAt: "2026-07-18T20:00:00.000Z" };
    expect(isExpired(check, Date.parse("2026-07-18T19:59:59.000Z"))).toBe(false);
    expect(isExpired(check, Date.parse("2026-07-18T20:00:01.000Z"))).toBe(true);
  });

  it("treats a malformed expiry as expired (fail closed)", () => {
    expect(isExpired({ expiresAt: "not-a-date" })).toBe(true);
  });

  it("activeCheckIns drops expired rows and sorts newest-first", () => {
    const now = Date.parse("2026-07-18T22:00:00.000Z");
    const rows: CheckIn[] = [
      mk("a", "2026-07-18T21:00:00.000Z", "2026-07-19T09:00:00.000Z"),
      mk("b", "2026-07-18T21:30:00.000Z", "2026-07-18T21:45:00.000Z"), // expired
      mk("c", "2026-07-18T21:15:00.000Z", "2026-07-19T09:15:00.000Z"),
    ];
    const active = activeCheckIns(rows, now);
    expect(active.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

function mk(id: string, createdAt: string, expiresAt: string): CheckIn {
  return {
    id,
    handle: "karan",
    areaSlug: "shoreditch",
    venueId: null,
    note: null,
    visibility: "friends",
    createdAt,
    expiresAt,
  };
}
