// Day | Tonight and the /out day chips wore `role="radio"` on anchors. That
// replaced the link role a screen reader announces, and it promised Space -
// the activation key ARIA specifies for a radio - which an anchor does not
// answer, so Enter was the only way in. They are links with aria-current now,
// and this is what makes the other key work.

import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { handleSegmentLinkKeyDown, isSegmentActivationKey } from "@/lib/segmentLinkKeys";

function keyEvent(key: string): {
  event: KeyboardEvent<HTMLElement>;
  click: ReturnType<typeof vi.fn>;
  preventDefault: ReturnType<typeof vi.fn>;
} {
  const click = vi.fn();
  const preventDefault = vi.fn();
  return {
    event: { key, currentTarget: { click }, preventDefault } as unknown as KeyboardEvent<HTMLElement>,
    click,
    preventDefault,
  };
}

describe("Space on a segmented link", () => {
  it("takes the option the reader is focused on", () => {
    const { event, click, preventDefault } = keyEvent(" ");
    handleSegmentLinkKeyDown(event);
    expect(click).toHaveBeenCalledTimes(1);
    // Or the page scrolls out from under the control it just took.
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("answers the legacy key name older engines still send", () => {
    const { event, click } = keyEvent("Spacebar");
    handleSegmentLinkKeyDown(event);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("claims no other key, so Enter and Tab keep the anchor's own meaning", () => {
    for (const key of ["Enter", "Tab", "ArrowRight", "a"]) {
      const { event, click, preventDefault } = keyEvent(key);
      handleSegmentLinkKeyDown(event);
      expect(click, key).not.toHaveBeenCalled();
      expect(preventDefault, key).not.toHaveBeenCalled();
    }
    expect(isSegmentActivationKey("Enter")).toBe(false);
    expect(isSegmentActivationKey(" ")).toBe(true);
  });
});
