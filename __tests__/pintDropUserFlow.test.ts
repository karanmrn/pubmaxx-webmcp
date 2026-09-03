// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerFields } from "@/components/map/composer/ComposerFields";
import { pintDropAuthorValue } from "@/lib/pintDropComposerIdentity";

const composerFieldsProps = {
  dropForm: { price: "4.2", drink: "Pint", note: "", era: "", withWho: "" },
  setDropForm: vi.fn(),
  vibeTags: [],
  toggleVibeTag: vi.fn(),
  maxTagsReached: false,
  visibility: "public" as const,
  setVisibility: vi.fn(),
  hasActiveRound: false,
  destination: null,
  chooseDestination: vi.fn(),
  setDestination: vi.fn(),
  speechSupported: false,
  listening: false,
  speechError: "",
  toggleListening: vi.fn(),
};

describe("venue-sheet Pint Drop author", () => {
  it("uses the signed-in account handle when a fresh device has no local handle", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: "night_owl",
        draftHandle: "",
        signedIn: true,
        identityReady: true,
      }),
    ).toEqual({
      handle: "night_owl",
      accountOwned: true,
      canSubmit: true,
    });
  });

  it("keeps keyless demo drafts available when no account handle exists", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: null,
        draftHandle: "demo_drinker",
        signedIn: false,
        identityReady: false,
      }),
    ).toEqual({
      handle: "demo_drinker",
      accountOwned: false,
      canSubmit: true,
    });
  });

  it("blocks a signed-out Pint Drop when account auth is configured", () => {
    const configuredAuthInput = {
      accountHandle: null,
      draftHandle: "self_asserted",
      signedIn: false,
      identityReady: true,
      authRequired: true,
    };

    expect(pintDropAuthorValue(configuredAuthInput)).toEqual({
      handle: "",
      accountOwned: false,
      canSubmit: false,
    });
  });

  it("does not let a stale local draft override account ownership", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: "night_owl",
        draftHandle: "old_device_handle",
        signedIn: true,
        identityReady: true,
      }),
    ).toEqual({
      handle: "night_owl",
      accountOwned: true,
      canSubmit: true,
    });
  });

  it("does not expose a stale local handle while signed-in identity is unresolved", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: null,
        draftHandle: "old_device_handle",
        signedIn: true,
        identityReady: false,
      }),
    ).toEqual({
      handle: "",
      accountOwned: false,
      canSubmit: false,
    });
  });

  it("blocks signed-in submission until profile identity is ready", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: null,
        draftHandle: "old_device_handle",
        signedIn: true,
        identityReady: true,
      }),
    ).toEqual({
      handle: "",
      accountOwned: false,
      canSubmit: false,
    });
  });

  it("keeps author identity out of the optional fields — the compact door owns it", () => {
    // Price-first door (report D2): the account handle is shown by the compact
    // door as "Posting as @handle", never edited, and the typed handle input
    // exists only on the keyless demo path. Both are pinned in
    // __tests__/pintDropPriceFirstDoor.test.tsx. The optional half must carry
    // no handle input at all, so a stale device draft can never be typed over
    // an account-bound author.
    document.body.innerHTML = renderToStaticMarkup(
      createElement(ComposerFields, composerFieldsProps),
    );

    // Query the control by its stable field label, not by sample values: a
    // future handle input under any name or value must still fail this.
    const fieldLabels = Array.from(
      document.querySelectorAll(".spillFieldLabel"),
    ).map((label) => label.textContent?.trim());
    expect(fieldLabels).toContain("Story");
    expect(fieldLabels).toContain("With");
    expect(fieldLabels).not.toContain("Handle");
    expect(document.querySelector('input[placeholder^="@thirsty"]')).toBeNull();
  });
});
