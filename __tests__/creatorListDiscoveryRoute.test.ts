import { describe, expect, it, vi } from "vitest";

type Subject = typeof import("@/lib/creatorListDiscoveryRoute.server");

async function loadSubject(): Promise<Subject> {
  const subject = await import("@/lib/creatorListDiscoveryRoute.server").catch(() => null);
  expect(subject, "creator-list discovery route must exist").not.toBeNull();
  return subject as Subject;
}

describe("GET /api/creator-lists", () => {
  it("returns public creator lists with a no-store response", async () => {
    const { handleCreatorListDiscoveryRequest } = await loadSubject();
    const listProfiles = vi.fn(async () => [{ handle: "alice" }]);
    const response = await handleCreatorListDiscoveryRequest(
      new Request("https://example.test/api/creator-lists?limit=1&after=before"),
      {
        isLimited: async () => false,
        isStoreAvailable: () => true,
        listProfiles,
        listSavedByHandles: async ({ handles }) =>
          new Map(
            handles.map((handle) => [
              handle,
              [
                {
                  venueId: "venue-1",
                  venueName: "The Fox",
                  venueMapUrl: "/map?sel=venue-1",
                  listType: "Best gardens",
                  savedAt: "2026-08-24T12:00:00.000Z",
                },
              ],
            ]),
          ),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      lists: [
        {
          ownerHandle: "alice",
          listType: "Best gardens",
          listUrl: "/u/alice/lists/Best%20gardens",
          mapUrl: "/map?mode=build&pubs=venue-1&sel=venue-1",
          planUrl: "/plan?query=Plan+Best+gardens+by+%40alice",
          savedCount: 1,
          updatedAt: "2026-08-24T12:00:00.000Z",
          previewVenues: [
            {
              venueId: "venue-1",
              venueName: "The Fox",
              venueMapUrl: "/map?sel=venue-1",
            },
          ],
        },
      ],
      nextCursor: null,
    });
    expect(listProfiles).toHaveBeenCalledWith({
      limit: 2,
      afterHandle: "before",
    });
  });

  it("rejects an invalid owner-page limit before reading stores", async () => {
    const { handleCreatorListDiscoveryRequest } = await loadSubject();
    const listProfiles = vi.fn();
    const response = await handleCreatorListDiscoveryRequest(
      new Request("https://example.test/api/creator-lists?limit=25"),
      {
        isLimited: async () => false,
        isStoreAvailable: () => true,
        listProfiles,
        listSavedByHandles: vi.fn(),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it("returns degraded rather than an empty market when a saved-list read fails", async () => {
    const { handleCreatorListDiscoveryRequest } = await loadSubject();
    const response = await handleCreatorListDiscoveryRequest(
      new Request("https://example.test/api/creator-lists"),
      {
        isLimited: async () => false,
        isStoreAvailable: () => true,
        listProfiles: async () => [{ handle: "alice" }],
        listSavedByHandles: async ({ handles }) =>
          new Map(handles.map((handle) => [handle, { status: "unavailable" as const }])),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "degraded",
      lists: [],
      nextCursor: null,
    });
  });

  it("fails closed when durable public data is unavailable", async () => {
    const { handleCreatorListDiscoveryRequest } = await loadSubject();
    const response = await handleCreatorListDiscoveryRequest(
      new Request("https://example.test/api/creator-lists"),
      {
        isLimited: async () => false,
        isStoreAvailable: () => false,
        listProfiles: vi.fn(),
        listSavedByHandles: vi.fn(),
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
  });
});
