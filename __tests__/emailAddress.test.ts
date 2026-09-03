import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  MAX_EMAIL_LENGTH,
  normalizeEmail,
  parseEmail,
} from "@/lib/emailAddress";

// Carried from the retired emailSubscribers suite: the capture path went with
// the digest that never shipped, the address rules stayed because
// lib/areaDemand.ts still validates with them.
describe("email address validation", () => {
  it("accepts a plausible address once normalised", () => {
    expect(isValidEmail("you@example.com")).toBe(true);
    expect(isValidEmail("  You@Example.COM ")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects empty, spaceful, @-less, or dot-less strings", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("no at sign.com")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it("rejects an address longer than the max length", () => {
    const long = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(long.length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(isValidEmail(long)).toBe(false);
  });

  it("normalises to trimmed lower-case", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail(123)).toBe("");
  });

  it("parseEmail returns the canonical form or null", () => {
    expect(parseEmail("  You@Example.com ")).toBe("you@example.com");
    expect(parseEmail("bad")).toBeNull();
  });
});
