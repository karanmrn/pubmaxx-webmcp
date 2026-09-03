import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const sourcePreview = {
  kind: "public" as const,
  crewId: CREW_ID,
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000000Z",
  stopVenueId: "venue-london-camden-arms",
  stopVenueName: "Camden Arms",
};

const store = vi.hoisted(() => ({ readPublicPreview: vi.fn() }));
const resolveMeeting = vi.hoisted(() => ({ resolveOpenMeetingPoint: vi.fn() }));

vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/openSocialCrew.server", () => resolveMeeting);

import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { GET } from "@/app/api/social/crews/[crewId]/public/route";

function context(crewId = CREW_ID): { params: Promise<{ crewId: string }> } {
  return { params: Promise.resolve({ crewId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  store.readPublicPreview.mockResolvedValue(sourcePreview);
  resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({
    ok: true,
    meetingPoint: {
      kind: "venue",
      name: "Camden Arms",
      lat: 51.541,
      lng: -0.142,
      cityId: "london",
    },
  });
});

describe("GET /api/social/crews/:crewId/public", () => {
  it("hides public crew data during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const response = await GET(
      new Request(`https://pubmaxxing.com/api/social/crews/${CREW_ID}/public`),
      context(),
    );

    expect(response.status).toBe(503);
    expect(store.readPublicPreview).not.toHaveBeenCalled();
    expect(resolveMeeting.resolveOpenMeetingPoint).not.toHaveBeenCalled();
  });

  it("returns account-free public data through the listed Stop 1 resolver", async () => {
    const response = await GET(
      new Request(`https://pubmaxxing.com/api/social/crews/${CREW_ID}/public`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      kind: "public",
      crewId: CREW_ID,
      title: "Friday in Camden",
      hostHandle: "host",
      startsAt: "2026-08-23T18:30:00.000Z",
      meetingPoint: {
        kind: "venue",
        name: "Camden Arms",
        lat: 51.541,
        lng: -0.142,
      },
    });
    expect(resolveMeeting.resolveOpenMeetingPoint).toHaveBeenCalledWith(
      sourcePreview.stopVenueId,
    );
    expect(JSON.stringify(body)).not.toContain("memberCount");
    expect(JSON.stringify(body)).not.toContain("visibility");
    expect(JSON.stringify(body)).not.toContain("stopVenueId");
  });

  it("does not expose a row when Stop 1 is no longer listed", async () => {
    resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({ ok: false, reason: "refused" });

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());

    expect(response.status).toBe(404);
    expect(store.readPublicPreview).toHaveBeenCalledWith(CREW_ID);
  });

  it.each([
    new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."),
    new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now."),
  ])("maps public store errors without leaking authority", async (error) => {
    store.readPublicPreview.mockRejectedValueOnce(error);

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());

    expect(response.status).toBe(error.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("hostHandle");
    expect(JSON.stringify(body)).not.toContain("member");
  });

  it("rejects a malformed crew id before reading the store", async () => {
    const response = await GET(
      new Request("https://pubmaxxing.com/api/social/crews/not-a-crew/public"),
      context("not-a-crew"),
    );

    expect(response.status).toBe(404);
    expect(store.readPublicPreview).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
