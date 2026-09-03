import { describe, expect, it } from "vitest";

import {
  AUTH_MENU_FOCUSABLE_SELECTOR,
  authMenuFocusBoundary,
} from "@/lib/authFocus";

describe("auth popover focus trap", () => {
  it("excludes controls disabled after a magic link is sent", () => {
    expect(AUTH_MENU_FOCUSABLE_SELECTOR).toContain("button:not(:disabled)");
    expect(AUTH_MENU_FOCUSABLE_SELECTOR).toContain("input:not(:disabled)");
  });

  it("recovers focus when the active submit has just become disabled", () => {
    const google = { id: "google" };
    const microsoft = { id: "microsoft" };
    const justDisabledSubmit = { id: "email-submit" };
    const enabled = [google, microsoft];

    expect(authMenuFocusBoundary(enabled, justDisabledSubmit, false)).toBe(google);
    expect(authMenuFocusBoundary(enabled, justDisabledSubmit, true)).toBe(microsoft);
  });

  it("wraps only at enabled boundaries", () => {
    const first = { id: "first" };
    const middle = { id: "middle" };
    const last = { id: "last" };
    const enabled = [first, middle, last];

    expect(authMenuFocusBoundary(enabled, first, true)).toBe(last);
    expect(authMenuFocusBoundary(enabled, last, false)).toBe(first);
    expect(authMenuFocusBoundary(enabled, middle, false)).toBeNull();
  });
});
