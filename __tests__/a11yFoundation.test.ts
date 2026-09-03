import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SkipLink from "@/components/a11y/SkipLink";
import PersonaLensPicker from "@/components/map/PersonaLensPicker";
import { focusMainLandmark, MAIN_LANDMARK_ID } from "@/lib/a11yLandmarks";
import {
  mobileSheetFocusContained,
  mobileSheetIsModal,
} from "@/lib/mobileSheetA11y";
import {
  buildPersonaPickerListEntries,
  stepPersonaPickerActiveIndex,
} from "@/lib/personaLensPickerA11y";
import type { PersonaDrink } from "@/lib/personaDrinks";

const samplePersona = (id: string): PersonaDrink => ({
  id,
  name: id,
  kind: "person",
  knownFor: "test",
  drink: "Pint",
  drinkCategory: "beer",
  why: "Reported favourite.",
  sourceUrl: "https://example.com",
  sourceName: "Example",
  observedAt: "2020-01-01",
  ingredients: [],
  howToOrder: "A pint, please.",
  confidence: "high",
});

describe("MAIN_LANDMARK_ID", () => {
  it("matches the skip-link target", () => {
    expect(MAIN_LANDMARK_ID).toBe("main");
  });
});

describe("mobileSheetFocusContained", () => {
  it("traps at half and full, not peek", () => {
    expect(mobileSheetFocusContained("half")).toBe(true);
    expect(mobileSheetFocusContained("full")).toBe(true);
    expect(mobileSheetFocusContained("peek")).toBe(false);
  });

  it("mirrors modal snaps", () => {
    expect(mobileSheetIsModal("half")).toBe(true);
    expect(mobileSheetIsModal("peek")).toBe(false);
  });
});

describe("buildPersonaPickerListEntries", () => {
  it("prepends a clear row when a persona is active", () => {
    const entries = buildPersonaPickerListEntries({
      includeClear: true,
      sections: [{ personas: [samplePersona("a")] }],
    });
    expect(entries).toEqual([
      { kind: "clear" },
      { kind: "persona", persona: samplePersona("a") },
    ]);
  });
});

describe("stepPersonaPickerActiveIndex", () => {
  it("wraps at both ends", () => {
    expect(stepPersonaPickerActiveIndex(0, -1, 3)).toBe(2);
    expect(stepPersonaPickerActiveIndex(2, 1, 3)).toBe(0);
  });

  it("starts from the first or last row when nothing is highlighted", () => {
    expect(stepPersonaPickerActiveIndex(-1, 1, 3)).toBe(0);
    expect(stepPersonaPickerActiveIndex(-1, -1, 3)).toBe(2);
  });
});

describe("SkipLink", () => {
  it("targets the shared main landmark", () => {
    const html = renderToStaticMarkup(createElement(SkipLink));
    expect(html).toContain('href="#main"');
    expect(html).toContain("Skip to main content");
  });
});

describe("focusMainLandmark", () => {
  it("focuses #main and makes it tabbable when needed", () => {
    const attrs = new Map<string, string>();
    let focused = false;
    const main = {
      hasAttribute: (name: string) => attrs.has(name),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, value);
      },
      focus: () => {
        focused = true;
      },
      scrollIntoView: () => undefined,
    };
    const doc = {
      getElementById: (id: string) => (id === MAIN_LANDMARK_ID ? main : null),
    };

    expect(focusMainLandmark(doc)).toBe(true);
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(focused).toBe(true);
  });

  it("returns false when the landmark is missing", () => {
    expect(focusMainLandmark({ getElementById: () => null })).toBe(false);
  });
});

describe("PersonaLensPicker semantics", () => {
  it("does not mix dialog and listbox roles", () => {
    const html = renderToStaticMarkup(
      createElement(PersonaLensPicker, {
        personaId: null,
        onSelect: vi.fn(),
        tonightCategory: null,
      }),
    );
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-haspopup="listbox"');
  });
});
