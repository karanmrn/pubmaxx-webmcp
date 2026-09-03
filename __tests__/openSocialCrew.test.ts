import { describe, expect, it } from "vitest";
import {
  classifyOpenMeetingPoint,
  firstPlanStop,
  OPEN_PLAN_PLACE_REFUSED_LINE,
  parseOpenPlaceId,
} from "@/lib/openSocialCrew";

describe("open plan meeting point", () => {
  it("takes the lowest-position stop as Stop 1", () => {
    expect(
      firstPlanStop([
        { venueId: "venue-b", venueName: "Second", position: 2 },
        { venueId: "venue-a", venueName: "First", position: 0 },
        { venueId: "venue-c", venueName: "Third", position: 1 },
      ]),
    ).toEqual({ venueId: "venue-a", venueName: "First", position: 0 });
  });

  it("classifies a slim-index venue id", () => {
    expect(classifyOpenMeetingPoint("venue-angel-islington")).toEqual({
      kind: "venue",
      venueId: "venue-angel-islington",
    });
  });

  it("classifies a place: POI id", () => {
    expect(classifyOpenMeetingPoint("place:tube-kings-cross-st-pancras")).toEqual({
      kind: "place",
      placeId: "tube-kings-cross-st-pancras",
    });
    expect(parseOpenPlaceId("place:osm-123")).toBe("osm-123");
  });

  it("refuses free text and a bare place prefix", () => {
    expect(classifyOpenMeetingPoint("by the canal near the bridge")).toEqual({
      kind: "refused",
    });
    expect(classifyOpenMeetingPoint("place:")).toEqual({ kind: "refused" });
    expect(classifyOpenMeetingPoint("")).toEqual({ kind: "refused" });
    expect(OPEN_PLAN_PLACE_REFUSED_LINE).toMatch(/listed pub or a named public place/);
  });
});
