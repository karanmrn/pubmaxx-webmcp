import { describe, expect, it } from "vitest";

import {
  moderatorReportEvidence,
  profileCoverFromAvatar,
  readQueueResponse,
} from "@/app/admin/AdminClient";

describe("admin profile cover queue", () => {
  it("does not present the verified counter as an anonymous report total", () => {
    const none = moderatorReportEvidence(0, undefined);
    const oneAnonymous = moderatorReportEvidence(0, "2026-08-23T09:00:00.000Z");
    const twoAnonymous = moderatorReportEvidence(0, "2026-08-23T09:01:00.000Z");
    const mixed = moderatorReportEvidence(1, "2026-08-23T09:02:00.000Z");

    expect(none).toEqual({ verifiedCount: 0, hasEvidence: false });
    expect(oneAnonymous).toEqual({ verifiedCount: 0, hasEvidence: true });
    expect(twoAnonymous).toEqual({ verifiedCount: 0, hasEvidence: true });
    expect(mixed).toEqual({ verifiedCount: 1, hasEvidence: true });
  });
  it("closes non-ok queue responses instead of leaving their body open", async () => {
    const response = new Response("temporary failure", { status: 503 });

    expect(await readQueueResponse(response)).toEqual({});
    expect(response.bodyUsed).toBe(true);
  });

  it("converts profile-level cover rows into whole-profile moderation rows", () => {
    expect(
      profileCoverFromAvatar({
        handle: "mirror",
        profileId: "profile-1",
        generation: "generation-1",
        moderationState: "approved",
        reportCount: 2,
        reportedAt: "2026-08-23T09:00:00.000Z",
        reportReason: "wrong backdrop",
        previewUrl: "/api/cover/profile-1/generation-1",
      }),
    ).toEqual({
      id: "profile-cover:profile-1",
      profileId: "profile-1",
      handle: "mirror",
      position: 1,
      generation: "generation-1",
      moderationState: "approved",
      reportCount: 2,
      reportedAt: "2026-08-23T09:00:00.000Z",
      reportReason: "wrong backdrop",
      previewUrl: "/api/cover/profile-1/generation-1",
      rotationOnly: false,
    });
  });
});
