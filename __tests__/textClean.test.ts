import { describe, expect, it } from "vitest";

import { cleanText, isHttpUrl, readString } from "@/lib/textClean";

describe("readString", () => {
  it("returns non-empty strings unchanged (no trim on return value)", () => {
    expect(readString("  hello  ")).toBe("  hello  ");
  });

  it("returns undefined for blank or non-string values", () => {
    expect(readString("")).toBeUndefined();
    expect(readString("   ")).toBeUndefined();
    expect(readString(null)).toBeUndefined();
    expect(readString(42)).toBeUndefined();
  });
});

describe("cleanText", () => {
  it("strips angle brackets used for inline HTML", () => {
    expect(cleanText("<script>alert(1)</script>", 200)).toBe("scriptalert(1)/script");
  });

  it("replaces ASCII control characters with spaces", () => {
    expect(cleanText("hello\u0000world\u0007", 200)).toBe("hello world");
    expect(cleanText("tab\there", 200)).toBe("tab here");
    expect(cleanText("del\u007fend", 200)).toBe("del end");
  });

  it("collapses whitespace and caps length", () => {
    expect(cleanText("  too   many   spaces  ", 200)).toBe("too many spaces");
    expect(cleanText("abcdefghij", 5)).toBe("abcde");
  });

  it("returns empty string for non-string input", () => {
    expect(cleanText(undefined, 100)).toBe("");
    expect(cleanText(123, 100)).toBe("");
  });
});

describe("isHttpUrl", () => {
  it("accepts well-formed http(s) URLs within the cap", () => {
    expect(isHttpUrl("https://example.com/avatar.png", 200)).toBe(
      "https://example.com/avatar.png",
    );
    expect(isHttpUrl(" http://localhost:3000/x ", 200)).toBe("http://localhost:3000/x");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(isHttpUrl("javascript:alert(1)", 200)).toBeUndefined();
    expect(isHttpUrl("data:text/html,hello", 200)).toBeUndefined();
  });

  it("rejects malformed, empty, or over-long values", () => {
    expect(isHttpUrl("", 200)).toBeUndefined();
    expect(isHttpUrl("not-a-url", 200)).toBeUndefined();
    expect(isHttpUrl("https://example.com", 10)).toBeUndefined();
    expect(isHttpUrl(null, 200)).toBeUndefined();
  });
});
