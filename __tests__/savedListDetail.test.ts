import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const socialState = vi.hoisted(() => ({ enabled: true, viewerHandle: "" }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "viewer" } }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => socialState.viewerHandle || null,
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => socialState.enabled,
}));

import SavedListDetail from "@/components/profile/SavedListDetail";

afterEach(() => {
  socialState.enabled = true;
  socialState.viewerHandle = "";
});

describe("SavedListDetail", () => {
  it("renders an authored custom list with neutral venue copy", () => {
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "my locals",
        venues: [
          {
            venueId: "venue-1",
            venueName: "The Test Arms",
            venueMapUrl: "/map?sel=venue-1",
            listType: "my locals",
            note: "Quiet corner table.",
            savedAt: "2026-07-07T12:00:00.000Z",
          },
        ],
        initialCounts: { followers: 4, savedPubs: 1 },
      }),
    );

    expect(html).toContain("my locals");
    expect(html).toContain("By @sam");
    expect(html).toContain('href="/u/sam"');
    expect(html).toContain("1 venue");
    expect(html).toContain("4 followers");
    expect(html).toContain("The Test Arms");
    expect(html).toContain("Quiet corner table.");
    expect(html).toContain(
      'href="/map?mode=build&amp;pubs=venue-1&amp;sel=venue-1"',
    );
    expect(html).toContain("View list on Map");
    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain('aria-label="Share this"');
    expect(html).toContain("Share");
    expect(html).toContain(
      "sam&#x27;s my locals list. 1 venue on PUBMAXXING.",
    );
    expect(html).toContain("Venues in this list");
    expect(html).toContain("%2Fu%2Fsam%2Flists%2Fmy%2520locals");
  });

  it("shows a follow control only when live viewer identity differs", () => {
    socialState.viewerHandle = "ken";
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "Date Night",
        venues: [],
        initialCounts: { followers: 0, savedPubs: 0 },
      }),
    );
    socialState.viewerHandle = "sam";
    const ownHtml = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "Date Night",
        venues: [],
        initialCounts: { followers: 0, savedPubs: 0 },
      }),
    );

    expect(html).toContain("Follow list");
    expect(ownHtml).not.toContain("Follow list");
    expect(html).not.toContain("View list on Map");
  });

  it("opens every list venue as one ordered Map plan", () => {
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "Sunday finds",
        venues: [
          {
            venueId: "venue-alpha",
            venueName: "The Alpha",
            venueMapUrl: "/map?sel=venue-alpha",
            listType: "Sunday finds",
            savedAt: "2026-08-24T12:00:00.000Z",
          },
          {
            venueId: "venue-beta",
            venueName: "The Beta",
            venueMapUrl: "/map?sel=venue-beta",
            listType: "Sunday finds",
            savedAt: "2026-08-24T11:00:00.000Z",
          },
        ],
        initialCounts: { followers: 2, savedPubs: 2 },
      }),
    );

    expect(html).toContain("View list on Map");
    expect(html).toContain(
      'href="/map?mode=build&amp;pubs=venue-alpha%2Cvenue-beta&amp;sel=venue-alpha"',
    );
  });

  it("hides Social relation controls and counts during rollback", () => {
    socialState.enabled = false;
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "Date Night",
        venues: [],
        initialCounts: { followers: 4, savedPubs: 0 },
      }),
    );

    expect(html).not.toContain("Follow list");
    expect(html).not.toContain("4 followers");
    socialState.enabled = true;
  });
});
