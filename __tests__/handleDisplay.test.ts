import { describe, expect, it } from "vitest";

import { displayHandle, handleOnly } from "@/lib/handleDisplay";

describe("displayHandle", () => {
  it("prepends a single @ to a bare handle", () => {
    expect(displayHandle("wapping_wall_ted")).toBe("@wapping_wall_ted");
  });

  it("does NOT double the @ when the handle already carries one (the bug)", () => {
    // The confirmed live bug: seeds like @wapping_wall_ted rendered as "@@…".
    expect(displayHandle("@wapping_wall_ted")).toBe("@wapping_wall_ted");
  });

  it("collapses multiple leading @s to exactly one", () => {
    expect(displayHandle("@@x")).toBe("@x");
    expect(displayHandle("@@@london_w4")).toBe("@london_w4");
  });

  it("lowercases a seeded @London_W4 handle", () => {
    expect(displayHandle("@London_W4")).toBe("@london_w4");
  });

  it("strips characters outside the handle alphabet", () => {
    expect(displayHandle("@Old Ken!")).toBe("@oldken");
  });

  it("falls back to @anon for empty / whitespace / nullish input", () => {
    expect(displayHandle("")).toBe("@anon");
    expect(displayHandle("   ")).toBe("@anon");
    expect(displayHandle("@")).toBe("@anon");
    expect(displayHandle("@@@")).toBe("@anon");
    expect(displayHandle(null)).toBe("@anon");
    expect(displayHandle(undefined)).toBe("@anon");
  });

  it("never yields a double @ for any of these inputs", () => {
    const inputs: Array<string | null | undefined> = [
      "wapping_wall_ted",
      "@wapping_wall_ted",
      "@@x",
      "@@@london_w4",
      "@London_W4",
      "@Old Ken!",
      "",
      "   ",
      "@",
      "@@@",
      null,
      undefined,
    ];
    for (const input of inputs) {
      expect(displayHandle(input)).not.toContain("@@");
    }
  });
});

describe("handleOnly", () => {
  it("returns the bare normalized handle with no @", () => {
    expect(handleOnly("@Wapping_Wall_Ted")).toBe("wapping_wall_ted");
    expect(handleOnly("old_ken")).toBe("old_ken");
  });

  it("is safe for a /u/<handle> URL — never leading @, never empty", () => {
    // A profile link built as `/u/${handleOnly(raw)}` must not carry a stray @
    // and must not point at "/u/".
    expect(`/u/${handleOnly("@London_W4")}`).toBe("/u/london_w4");
    expect(handleOnly("")).toBe("anon");
    expect(handleOnly(null)).toBe("anon");
    expect(handleOnly("@")).toBe("anon");
    expect(handleOnly("@London_W4")).not.toContain("@");
  });
});
