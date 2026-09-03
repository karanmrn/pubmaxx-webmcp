import { describe, expect, it } from "vitest";

import { INVITE_HANDLE_MAX, inviteCardModel } from "@/lib/inviteShare";

// Pure model behind the crew-invite share surface (/add/[handle]) and its OG
// card. Hermetic: no clock, no I/O, no env — fixed inputs, fixed outputs.

describe("inviteCardModel", () => {
  it("builds a named invite from a real handle", () => {
    const model = inviteCardModel("cheap_pint_ken");
    expect(model.handle).toBe("cheap_pint_ken");
    expect(model.displayName).toBe("@cheap_pint_ken");
    expect(model.title).toBe("Add @cheap_pint_ken to your lot");
    expect(model.kicker).toBe("Your lot on PUBMAXX");
    expect(model.sub).toContain("A lot is mutual");
  });

  it("normalizes a handle with a leading @ and mixed case", () => {
    const model = inviteCardModel("@KaranSZNX");
    expect(model.handle).toBe("karansznx");
    expect(model.displayName).toBe("@karansznx");
    expect(model.title).toBe("Add @karansznx to your lot");
  });

  it("falls back to the generic invite when the link carries no handle", () => {
    for (const raw of ["", "   ", "@@@", null, undefined]) {
      const model = inviteCardModel(raw);
      expect(model.handle).toBe("");
      expect(model.displayName).toBe("a mate");
      expect(model.title).toBe("Add me to your lot");
    }
  });

  it("clamps an over-long handle so a card layout can never overflow", () => {
    const model = inviteCardModel("a".repeat(60));
    expect(model.handle.length).toBe(INVITE_HANDLE_MAX);
    expect(model.title.startsWith("Add @")).toBe(true);
  });

  it("never emits an em dash in card copy", () => {
    const model = inviteCardModel("someone");
    for (const value of [model.title, model.sub, model.kicker, model.cta]) {
      expect(value.includes("—")).toBe(false);
    }
  });
});
