import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as socialCrewsUi from "@/lib/socialCrewsUi";
import {
  createSocialCrewStore,
  type SocialCrewStoreDependencies,
} from "@/lib/socialCrewStore";
import type { SocialPostActor } from "@/lib/socialPostStore";

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "20000000-0000-4000-8000-000000000001";

const host: SocialPostActor = {
  accountId: ACCOUNT_ID,
  profileId: PROFILE_ID,
  handle: "alice",
};

const queue = {
  items: [
    {
      requestId: REQUEST_ID,
      requesterHandle: "bob",
    },
  ],
  hasMore: false,
};

function storeReturning(value: unknown) {
  const snapshot = vi.fn(async () => value);
  const store = createSocialCrewStore({
    rpc: vi.fn(async () => {
      throw new Error("queue read must not use a write RPC");
    }),
    snapshot,
    signingKey: () => Buffer.from("join-request-queue-test-key-0001", "utf8"),
  } as unknown as SocialCrewStoreDependencies);
  return { store, snapshot };
}

describe("Social Crew host join-request queue", () => {
  it("reads a private queue with actor and crew authority", async () => {
    const { store, snapshot } = storeReturning(queue);

    const result = await (store as unknown as {
      listJoinRequests(crewId: string, actor: SocialPostActor): Promise<unknown>;
    }).listJoinRequests(CREW_ID, host);

    expect(result).toEqual(queue);
    expect(snapshot).toHaveBeenCalledWith("read_social_crew_join_requests", {
      p_viewer_account_id: ACCOUNT_ID,
      p_viewer_profile_id: PROFILE_ID,
      p_crew_id: CREW_ID,
    });
  });

  it("fails closed when the queue projection is malformed", async () => {
    const { store } = storeReturning({
      items: [{ ...queue.items[0], requesterAccountId: ACCOUNT_ID }],
    });

    await expect(
      (store as unknown as {
        listJoinRequests(crewId: string, actor: SocialPostActor): Promise<unknown>;
      }).listJoinRequests(CREW_ID, host),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
  });

  it("parses only the private display contract used by the host UI", () => {
    const parse = (socialCrewsUi as unknown as {
      parseCrewJoinRequestQueue(value: unknown): unknown;
    }).parseCrewJoinRequestQueue;

    expect(parse(queue)).toEqual(queue);
    expect(
      parse({ items: [{ ...queue.items[0], requesterHandle: "" }], hasMore: false }),
    ).toBeNull();
    expect(
      parse({
        items: [{ ...queue.items[0], requesterAccountId: ACCOUNT_ID }],
        hasMore: false,
      }),
    ).toBeNull();
  });

  it("ships a service-only authority check in migration 0114", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260823100000_0114_social_crew_join_request_queue.sql",
      ),
      "utf8",
    )
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    expect(sql).toContain("create function public.read_social_crew_join_requests");
    expect(sql).toContain("public._social_crew_member_role(p_crew_id, actor.id) in ('owner','cohost')");
    expect(sql).toContain(
      "revoke all on function public.read_social_crew_join_requests(uuid, uuid, uuid) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.read_social_crew_join_requests(uuid, uuid, uuid) to service_role",
    );
    expect(sql).not.toContain("'requesteraccountid'");
    expect(sql).not.toContain("'requesterprofileid'");
  });
});
