import { describe, expect, it } from "vitest";

import { formatInviteExpiry, invitePrivacyBlurb } from "@/lib/planInviteUi";

describe("planInviteUi", () => {
  const now = new Date("2026-07-16T20:00:00.000Z");

  it("formats relative expiry buckets", () => {
    expect(formatInviteExpiry("2026-07-16T20:25:00.000Z", now)).toBe("Expires in 25 min");
    expect(formatInviteExpiry("2026-07-16T23:00:00.000Z", now)).toBe("Expires in 3 h");
    expect(formatInviteExpiry("2026-07-18T20:00:00.000Z", now)).toBe("Expires in 2 days");
    expect(formatInviteExpiry("2026-07-16T19:00:00.000Z", now)).toBe("Expired");
  });

  it("keeps privacy blurb honest about pre-join disclosure", () => {
    expect(invitePrivacyBlurb()).toMatch(/One-use private link/);
    expect(invitePrivacyBlurb()).toMatch(/never the full stop list/);
  });
});
