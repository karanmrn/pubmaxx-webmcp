// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: (
    _url: string,
    _options: unknown,
    onData: (body: { kindObservedAt: Record<string, string>; rows: unknown[] }) => void,
  ) => {
    onData({
      kindObservedAt: {
        quiz: "2026-08-25T09:00:00.000Z",
        sport: "2026-08-25T09:00:00.000Z",
      },
      rows: [
        {
          id: "quiz-1",
          venueId: "venue-1",
          placeName: "The Test Arms",
          startsAt: "2026-08-25T19:00:00.000Z",
          title: "Pub quiz",
          source: { label: "Organiser", url: "https://example.com/quiz" },
          observedAt: "2026-08-25T09:00:00.000Z",
          confidence: "listed",
          kind: "quiz",
        },
        {
          id: "sport-1",
          venueId: "venue-1",
          placeName: "The Test Arms",
          startsAt: "2026-08-25T19:00:00.000Z",
          title: "Live sport",
          source: { label: "Organiser", url: "https://example.com/sport" },
          observedAt: "2026-08-25T09:00:00.000Z",
          confidence: "listed",
          kind: "sport",
        },
      ],
    });
    return Promise.resolve("network");
  },
}));

import VenueTonightChips from "@/components/map/VenueTonightChips";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("VenueTonightChips reveal", () => {
  it("reveals dated tonight chips with the checked stamp", async () => {
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(VenueTonightChips, {
          id: "venue-1",
          name: "The Test Arms",
          latitude: 51.5,
          longitude: -0.1,
          revealChecked: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const chips = [...container.querySelectorAll(".venueTonightChip")];
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.classList.contains("venueRevealRecord"))).toBe(true);
    expect(chips.every((chip) => chip.getAttribute("data-reveal-delay") === "2")).toBe(true);
    expect(
      container.querySelector(".venueTonightChecked")?.classList.contains("venueRevealRecord"),
    ).toBe(true);
  });

  it("reveals late tonight data without replaying the entrance delay", async () => {
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(VenueTonightChips, {
          id: "venue-1",
          name: "The Test Arms",
          latitude: 51.5,
          longitude: -0.1,
          revealChecked: true,
          revealCheckedLate: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const chips = [...container.querySelectorAll(".venueTonightChip")];
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.classList.contains("venueRevealRecord"))).toBe(true);
    expect(chips.every((chip) => chip.getAttribute("data-reveal-delay") === null)).toBe(true);
    expect(container.querySelector(".venueTonightChecked")?.getAttribute("data-reveal-delay")).toBeNull();
  });
});
