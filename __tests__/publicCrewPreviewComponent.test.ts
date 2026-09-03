import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PublicCrewPreview from "@/components/social/PublicCrewPreview";

const preview = {
  kind: "public" as const,
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000Z",
  meetingPoint: {
    kind: "venue" as const,
    name: "Camden Arms",
    lat: 51.541,
    lng: -0.142,
  },
};

describe("public Open Crew preview", () => {
  it("shows meeting point, host, start, and one join action", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview,
        joinState: "none",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Friday in Camden");
    expect(html).toContain("@host");
    expect(html).toContain("Camden Arms");
    expect(html).toContain('>Ask to join<');
    expect(html).not.toContain("memberCount");
    expect(html).not.toContain("Who is in");
  });

  it("replaces join action with deterministic request state", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview,
        joinState: "pending",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Request sent. The host decides.");
    expect(html).not.toContain("Ask to join");
  });
});
