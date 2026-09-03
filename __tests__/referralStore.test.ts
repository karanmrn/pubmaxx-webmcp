import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryReferrals,
  memoryReferralStore,
} from "@/lib/referralStore";

const DAY = 24 * 60 * 60 * 1_000;
const START = Date.parse("2026-07-28T10:00:00.000Z");

beforeEach(() => {
  __resetMemoryReferrals();
});

describe("referral attribution store", () => {
  it("records a code claim from a newly created account once", async () => {
    const invite = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const claimed = await memoryReferralStore.claimCode({
      code: invite.code,
      inviteeUserId: "invitee",
      inviteeCreatedAt: new Date(START - 1_000).toISOString(),
      authAttemptStartedAt: START - 2_000,
      now: START,
    });
    expect(claimed).toMatchObject({ ok: true, status: "recorded" });
    expect(
      await memoryReferralStore.claimCode({
        code: invite.code,
        inviteeUserId: "invitee",
        inviteeCreatedAt: new Date(START - 1_000).toISOString(),
        authAttemptStartedAt: START - 2_000,
        now: START,
      }),
    ).toMatchObject({ ok: true, status: "existing" });
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
    });
  });

  it("does not attribute an account created before the sign-up journey", async () => {
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");

    expect(
      await memoryReferralStore.claimCode({
        code,
        inviteeUserId: "existing-user",
        inviteeCreatedAt: new Date(START - 30 * 60 * 1_000).toISOString(),
        authAttemptStartedAt: START - 60 * 1_000,
        now: START,
      }),
    ).toEqual({ ok: false, reason: "account_not_new" });
  });

  it("rejects an unknown invite code", async () => {
    expect(
      await memoryReferralStore.claimCode({
        code: "unknown_code_123456789",
        inviteeUserId: "new-user",
        inviteeCreatedAt: new Date(START).toISOString(),
        authAttemptStartedAt: START - 1_000,
        now: START,
      }),
    ).toEqual({ ok: false, reason: "unknown" });
  });

  it("rejects same-account and direct circular edges before they can qualify", async () => {
    expect(
      await memoryReferralStore.recordEdge("user-a", "user-a", START),
    ).toEqual({ ok: false, reason: "self" });

    expect(
      await memoryReferralStore.recordEdge("user-a", "user-b", START),
    ).toMatchObject({ ok: true, status: "recorded" });
    expect(
      await memoryReferralStore.recordEdge("user-b", "user-a", START + 1),
    ).toEqual({ ok: false, reason: "circular" });

    expect(
      await memoryReferralStore.qualify({
        inviteeUserId: "user-a",
        contributionKind: "community_price",
        contributionId: "price-a",
        acceptedAt: START + 2,
      }),
    ).toEqual({ ok: false, reason: "no_edge" });
    expect(await memoryReferralStore.privateStatus("user-a")).toMatchObject({
      qualifiedCount: 0,
      earned: [],
      mark: null,
    });
  });

  it("records one immutable inviter per invited account", async () => {
    await memoryReferralStore.recordEdge("inviter-a", "invitee", START);

    expect(
      await memoryReferralStore.recordEdge("inviter-b", "invitee", START + 1),
    ).toEqual({ ok: false, reason: "already_attributed" });
    expect(
      await memoryReferralStore.recordEdge("inviter-a", "invitee", START + 2),
    ).toMatchObject({ ok: true, status: "existing" });
  });

  it("qualifies only the first accepted contribution and appends 1, 3 and 5 milestones", async () => {
    for (let index = 1; index <= 5; index += 1) {
      const invitee = `invitee-${index}`;
      await memoryReferralStore.recordEdge("inviter", invitee, START + index);
      const result = await memoryReferralStore.qualify({
        inviteeUserId: invitee,
        contributionKind: "community_price",
        contributionId: `price-${index}`,
        acceptedAt: START + DAY + index,
      });
      expect(result).toMatchObject({ ok: true, status: "qualified" });
    }

    expect(
      await memoryReferralStore.qualify({
        inviteeUserId: "invitee-1",
        contributionKind: "visit_report",
        contributionId: "visit-1",
        acceptedAt: START + 2 * DAY,
      }),
    ).toEqual({ ok: true, status: "existing" });

    const status = await memoryReferralStore.privateStatus("inviter");
    expect(status.qualifiedCount).toBe(5);
    // A milestone row records recognition and nothing else: a mark to print,
    // and no feature key, grant status or entitlement of any kind.
    expect(status.earned.map(({ milestone, mark }) => [milestone, mark])).toEqual([
      [1, "Brought a mate in"],
      [3, "Brought 3 mates in"],
      [5, "Brought 5 mates in"],
    ]);
    expect(status.mark).toBe("Brought 5 mates in");
    expect(JSON.stringify(status)).not.toMatch(/feature|grant/i);
  });

  it("returns aggregate private status without exposing either side of an edge", async () => {
    await memoryReferralStore.recordEdge("inviter-secret", "invitee-secret", START);
    const status = await memoryReferralStore.privateStatus("inviter-secret");
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain("inviter-secret");
    expect(serialized).not.toContain("invitee-secret");
  });

  it("erases every private referral record tied to a deleted account", async () => {
    await memoryReferralStore.recordEdge("inviter", "deleted-user", START);
    await memoryReferralStore.qualify({
      inviteeUserId: "deleted-user",
      contributionKind: "visit_report",
      contributionId: "visit-deleted",
      acceptedAt: START + 1,
    });

    await memoryReferralStore.eraseAccount("deleted-user");

    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
      qualifiedCount: 0,
      earned: [],
      mark: null,
    });
  });

  it("refuses every referral write after an identity is erased", async () => {
    const inviterCode = await memoryReferralStore.getOrCreateInviteCode(
      "deleted-user",
    );
    const otherCode = await memoryReferralStore.getOrCreateInviteCode("other");

    await memoryReferralStore.eraseAccount("deleted-user");

    await expect(
      memoryReferralStore.getOrCreateInviteCode("deleted-user"),
    ).rejects.toThrow();
    expect(
      await memoryReferralStore.claimCode({
        code: inviterCode.code,
        inviteeUserId: "fresh-invitee",
        inviteeCreatedAt: new Date(START + 1).toISOString(),
        authAttemptStartedAt: START,
        now: START + 1,
      }),
    ).toEqual({ ok: false, reason: "unknown" });
    expect(
      await memoryReferralStore.recordEdge(
        "deleted-user",
        "fresh-invitee",
        START + 1,
      ),
    ).toEqual({ ok: false, reason: "deleted_identity" });
    expect(
      await memoryReferralStore.recordEdge(
        "fresh-inviter",
        "deleted-user",
        START + 1,
      ),
    ).toEqual({ ok: false, reason: "deleted_identity" });
    expect(
      await memoryReferralStore.claimCode({
        code: otherCode.code,
        inviteeUserId: "deleted-user",
        inviteeCreatedAt: new Date(START).toISOString(),
        authAttemptStartedAt: START - 1,
        now: START + 1,
      }),
    ).toEqual({ ok: false, reason: "deleted_identity" });
    expect(
      await memoryReferralStore.qualify({
        inviteeUserId: "deleted-user",
        contributionKind: "visit_report",
        contributionId: "visit-after-erasure",
        acceptedAt: START + 1,
      }),
    ).toEqual({ ok: false, reason: "deleted_identity" });
  });

  it("records milestone three when qualifications arrive concurrently", async () => {
    for (let index = 1; index <= 3; index += 1) {
      await memoryReferralStore.recordEdge(
        "inviter",
        `concurrent-${index}`,
        START + index,
      );
    }

    await Promise.all(
      [1, 2, 3].map((index) =>
        memoryReferralStore.qualify({
          inviteeUserId: `concurrent-${index}`,
          contributionKind: "community_price",
          contributionId: `price-concurrent-${index}`,
          acceptedAt: START + DAY + index,
        })
      ),
    );

    expect(
      (await memoryReferralStore.privateStatus("inviter")).earned.map(
        ({ milestone }) => milestone,
      ),
    ).toEqual([1, 3]);
  });
});
