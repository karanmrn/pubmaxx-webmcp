import { describe, expect, it } from "vitest";

import type { NightMoment, PublicNightStory } from "@/lib/nightMemory";
import {
  NEUTRAL_ATTRIBUTION_TOKEN,
  redactPublicStoryFields,
  redactStoryView,
  type DepartedContributor,
} from "@/lib/storyRedaction";

function moment(overrides: Partial<NightMoment> & Pick<NightMoment, "id" | "ownerId">): NightMoment {
  return {
    memoryId: "mem-1",
    kind: "quote",
    caption: "",
    pintDropId: null,
    venueId: null,
    mediaObjectKey: null,
    occurredAt: null,
    visibility: "private",
    altText: null,
    altTextConfirmedAt: null,
    createdAt: "2026-07-19T20:00:00.000Z",
    ...overrides,
  };
}

function story(overrides: Partial<PublicNightStory> = {}): PublicNightStory {
  return {
    id: "story-1",
    title: "Friday orbit",
    summary: "A proper crawl.",
    status: "published",
    visibility: "public",
    legacyCrawlStoryId: null,
    publishedMomentIds: [],
    publishedAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

const jordan: DepartedContributor = { profileId: "friend", handle: "jordanx", displayName: "Jordan" };

describe("storyRedaction — pure emission-time redaction", () => {
  it("drops every Moment the departing contributor owns and keeps the rest intact", () => {
    const moments = [
      moment({ id: "m-host-1", ownerId: "host", caption: "The first pint" }),
      moment({ id: "m-friend-1", ownerId: "friend", caption: "My round", mediaObjectKey: "media/friend.webp", kind: "photo" }),
      moment({ id: "m-host-2", ownerId: "host", caption: "Last stop" }),
    ];
    const result = redactStoryView({ story: story(), moments, departed: [jordan] });
    expect(result.moments.map((m) => m.id)).toEqual(["m-host-1", "m-host-2"]);
    expect(result.moments.every((m) => m.ownerId === "host")).toBe(true);
    // The departed person's media never survives.
    expect(JSON.stringify(result.moments)).not.toContain("media/friend.webp");
  });

  it("replaces the departing handle and display name with the neutral token in surviving captions", () => {
    const moments = [
      moment({ id: "m1", ownerId: "host", caption: "Great night with @jordanx and the crew" }),
      moment({ id: "m2", ownerId: "host", caption: "Jordan bought the last round" }),
    ];
    const result = redactStoryView({ story: story(), moments, departed: [jordan] });
    expect(result.moments[0].caption).toBe(`Great night with ${NEUTRAL_ATTRIBUTION_TOKEN} and the crew`);
    expect(result.moments[1].caption).toBe(`${NEUTRAL_ATTRIBUTION_TOKEN} bought the last round`);
    expect(result.moments.map((m) => m.caption).join(" ")).not.toMatch(/jordan/i);
  });

  it("scrubs the Story title and summary too", () => {
    const redacted = redactPublicStoryFields(
      story({ title: "A night with Jordan", summary: "Ft. @jordanx on the aux" }),
      [jordan],
    );
    expect(redacted.title).toBe(`A night with ${NEUTRAL_ATTRIBUTION_TOKEN}`);
    expect(redacted.summary).toBe(`Ft. ${NEUTRAL_ATTRIBUTION_TOKEN} on the aux`);
  });

  it("never eats a substring of an unrelated word", () => {
    const moments = [moment({ id: "m1", ownerId: "host", caption: "Johnson's pub, not Jordan" })];
    const departed: DepartedContributor[] = [{ profileId: "friend", handle: "jon", displayName: "Jordan" }];
    const result = redactStoryView({ story: story(), moments, departed });
    expect(result.moments[0].caption).toBe(`Johnson's pub, not ${NEUTRAL_ATTRIBUTION_TOKEN}`);
  });

  it("is a no-op when nobody has departed", () => {
    const moments = [moment({ id: "m1", ownerId: "host", caption: "with @jordanx" })];
    const input = { story: story(), moments, departed: [] as DepartedContributor[] };
    const result = redactStoryView(input);
    expect(result.moments).toEqual(moments);
    expect(result.story).toEqual(input.story);
  });

  it("is deterministic — same input, same output", () => {
    const moments = [
      moment({ id: "m1", ownerId: "host", caption: "with @jordanx and Sam" }),
      moment({ id: "m2", ownerId: "friend", caption: "gone" }),
    ];
    const departed = [jordan, { profileId: "friend2", handle: "sam", displayName: "Sam" }];
    const a = redactStoryView({ story: story(), moments, departed });
    const b = redactStoryView({ story: story(), moments, departed });
    expect(a).toEqual(b);
  });

  it("does not mutate the input Moments (returns a fresh copy)", () => {
    const original = moment({ id: "m1", ownerId: "host", caption: "with @jordanx" });
    const snapshot = { ...original };
    redactStoryView({ story: story(), moments: [original], departed: [jordan] });
    expect(original).toEqual(snapshot);
  });
});
