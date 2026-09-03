import { describe, expect, it } from "vitest";

import { parsePublicCrewPreview } from "@/lib/socialCrewsUi";

const PREVIEW = {
  kind: "public",
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000Z",
  meetingPoint: {
    kind: "venue",
    name: "Camden Arms",
    lat: 51.541,
    lng: -0.142,
  },
};

describe("public Open Crew preview parser", () => {
  it("accepts only public preview fields", () => {
    expect(parsePublicCrewPreview(PREVIEW)).toEqual(PREVIEW);
  });

  it.each([
    ["member count", { memberCount: 2 }],
    ["visibility", { visibility: "open" }],
    ["full stop id", { stopVenueId: "venue-1" }],
    ["private plan", { plan: { id: "secret" } }],
  ])("rejects extra %s data", (_label, extra) => {
    expect(parsePublicCrewPreview({ ...PREVIEW, ...extra })).toBeNull();
  });

  it("rejects invalid meeting points and identifiers", () => {
    expect(parsePublicCrewPreview({ ...PREVIEW, crewId: "bad" })).toBeNull();
    expect(parsePublicCrewPreview({
      ...PREVIEW,
      meetingPoint: { ...PREVIEW.meetingPoint, lat: 200 },
    })).toBeNull();
    expect(parsePublicCrewPreview({
      ...PREVIEW,
      meetingPoint: { ...PREVIEW.meetingPoint, kind: "unknown" },
    })).toBeNull();
  });
});
