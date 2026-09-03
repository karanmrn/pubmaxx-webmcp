import { describe, expect, it } from "vitest";

import {
  altTextGapLabel,
  canEditNightStory,
  cleanNightMomentDraft,
  hasConfirmedAltText,
  hasPublicationConsent,
  momentNeedsAltTextConfirmation,
  NIGHT_MOMENT_ALT_TEXT_MAX,
  type MomentConsent,
  type StoryContributor,
} from "@/lib/nightMemory";

describe("Night Memory domain policy", () => {
  it("creates Moments as private and preserves a Pint Drop as a reference", () => {
    expect(cleanNightMomentDraft({
      kind: "pint_drop",
      caption: "First round at The Harp",
      pintDropId: "4f2e351c-74b7-4f31-b7ff-334b6106c88e",
    })).toEqual({
      kind: "pint_drop",
      caption: "First round at The Harp",
      pintDropId: "4f2e351c-74b7-4f31-b7ff-334b6106c88e",
      venueId: null,
      mediaObjectKey: null,
      occurredAt: null,
      visibility: "private",
      altText: null,
    });
  });

  it("rejects a Pint Drop Moment without a Pint Drop reference", () => {
    expect(cleanNightMomentDraft({ kind: "pint_drop", caption: "A pint" })).toBeNull();
  });

  it("carries author alt text through the trust boundary and caps its length", () => {
    const draft = cleanNightMomentDraft({
      kind: "photo",
      caption: "The crew",
      mediaObjectKey: "night-media/host/photo.webp",
      altText: "  Four friends toasting pints at a candlelit table.  ",
    });
    expect(draft?.altText).toBe("Four friends toasting pints at a candlelit table.");

    const capped = cleanNightMomentDraft({
      kind: "photo",
      mediaObjectKey: "night-media/host/photo.webp",
      altText: "a".repeat(NIGHT_MOMENT_ALT_TEXT_MAX + 50),
    });
    expect(capped?.altText?.length).toBe(NIGHT_MOMENT_ALT_TEXT_MAX);

    // Alt text alone never rescues an otherwise-empty Moment.
    expect(cleanNightMomentDraft({ kind: "photo", altText: "orphan description" })).toBeNull();
  });

  it("blocks a photo Moment without confirmed alt text and names it", () => {
    const base = {
      kind: "photo" as const,
      caption: "The rooftop at midnight",
      pintDropId: null,
      venueId: null,
      mediaObjectKey: "night-media/host/photo.webp",
      occurredAt: null,
      visibility: "private" as const,
    };
    // Media, no confirmed description → blocked.
    expect(momentNeedsAltTextConfirmation({ ...base, altText: null, altTextConfirmedAt: null })).toBe(true);
    // A value with no confirmation stamp (e.g. an unconfirmed AI suggestion) → still blocked.
    expect(momentNeedsAltTextConfirmation({ ...base, altText: "A guess", altTextConfirmedAt: null })).toBe(true);
    // Author-confirmed → cleared.
    expect(momentNeedsAltTextConfirmation({ ...base, altText: "A rooftop bar lit by string lights.", altTextConfirmedAt: "2026-07-21T00:00:00.000Z" })).toBe(false);
    expect(hasConfirmedAltText({ ...base, altText: "A rooftop bar lit by string lights.", altTextConfirmedAt: "2026-07-21T00:00:00.000Z" })).toBe(true);
    // A non-photo Moment never needs alt text.
    expect(momentNeedsAltTextConfirmation({ ...base, mediaObjectKey: null, altText: null, altTextConfirmedAt: null })).toBe(false);
    expect(altTextGapLabel(base)).toBe("The rooftop at midnight");
    expect(altTextGapLabel({ ...base, caption: "" })).toBe("one of your photos");
  });

  it("allows only active hosts and editors to shape a Story", () => {
    const contributors: StoryContributor[] = [
      { storyId: "story", profileId: "host", role: "host", status: "accepted", joinedAt: "now" },
      { storyId: "story", profileId: "editor", role: "editor", status: "accepted", joinedAt: "now" },
      { storyId: "story", profileId: "guest", role: "contributor", status: "accepted", joinedAt: "now" },
    ];
    expect(canEditNightStory("host", contributors)).toBe(true);
    expect(canEditNightStory("editor", contributors)).toBe(true);
    expect(canEditNightStory("guest", contributors)).toBe(false);
  });

  it("requires the Moment owner's current approval for publication", () => {
    const consent: MomentConsent = {
      storyId: "story",
      momentId: "moment",
      ownerId: "person",
      status: "approved",
      decidedAt: "now",
    };
    expect(hasPublicationConsent("person", "moment", [consent])).toBe(true);
    expect(hasPublicationConsent("someone-else", "moment", [consent])).toBe(false);
    expect(hasPublicationConsent("person", "moment", [{ ...consent, status: "withdrawn" }])).toBe(false);
  });
});
