import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc }),
}));

import { SocialCrewStoreError, createSocialCrewStore } from "@/lib/socialCrewStore";

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const SOURCE = {
  crewId: CREW_ID,
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000000Z",
  stopVenueId: "venue-camden-arms",
  stopVenueName: "Camden Arms",
};

beforeEach(() => vi.clearAllMocks());

describe("Social Crew public preview store", () => {
  it("uses service RPC and returns the strict source row", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: SOURCE, error: null });

    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).resolves.toEqual({
      ...SOURCE,
      startsAt: "2026-08-23T18:30:00.000Z",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("read_social_crew_public_preview", {
      p_crew_id: CREW_ID,
    });
  });

  it("fails closed on null, malformed, and extra authority fields", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    } satisfies Partial<SocialCrewStoreError>);

    supabase.rpc.mockResolvedValueOnce({
      data: { ...SOURCE, members: [{ handle: "secret" }] },
      error: null,
    });
    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
  });
});
