import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CreatorListsContent,
  parseCreatorListsResponse,
  settleCreatorListsResponse,
} from "@/components/social/CreatorListsLane";
import type { CreatorListDiscoveryItem } from "@/lib/creatorListDiscovery";

const LIST: CreatorListDiscoveryItem = {
  ownerHandle: "alice",
  ownerDisplayName: "Alice",
  listType: "Sunday roasts",
  listUrl: "/u/alice/lists/Sunday%20roasts",
  mapUrl: "/map?mode=build&pubs=venue-1%2Cvenue-2&sel=venue-1",
  planUrl: "/plan?query=Plan+Sunday+roasts+by+%40alice",
  savedCount: 2,
  updatedAt: "2026-08-24T12:00:00.000Z",
  previewVenues: [
    { venueId: "venue-1", venueName: "The Fox", venueMapUrl: "/map?sel=venue-1" },
    { venueId: "venue-2", venueName: "The Crown", venueMapUrl: "/map?sel=venue-2" },
  ],
};

describe("CreatorListsContent", () => {
  it("links a creator list to its author, public page and complete Map handoff", () => {
    const html = renderToStaticMarkup(
      createElement(CreatorListsContent, {
        status: "ready",
        lists: [LIST],
        viewerHandle: "bob",
      }),
    );

    expect(html).toContain("Creator lists");
    expect(html).toContain("Sunday roasts");
    expect(html).toContain("Alice");
    expect(html).toContain("The Fox");
    expect(html).toContain("The Crown");
    expect(html).toContain('href="/u/alice"');
    expect(html).toContain('href="/u/alice/lists/Sunday%20roasts"');
    expect(html).toContain(
      'href="/map?mode=build&amp;pubs=venue-1%2Cvenue-2&amp;sel=venue-1"',
    );
    expect(html).toContain('href="/plan?query=Plan+Sunday+roasts+by+%40alice"');
    expect(html).toContain("Plan night");
    expect(html).toContain("Follow list");
    expect(html).toContain("<button");
  });

  it("sends a signed-out viewer through sign in before following", () => {
    const html = renderToStaticMarkup(
      createElement(CreatorListsContent, { status: "ready", lists: [LIST] }),
    );

    expect(html).toContain("Follow list");
    expect(html).toContain("/login?mode=signin&amp;from=%2Fu%2Falice%2Flists%2FSunday%2520roasts");
  });

  it("keeps follow neutral while viewer identity resolves", () => {
    const html = renderToStaticMarkup(
      createElement(CreatorListsContent, {
        status: "ready",
        lists: [LIST],
        viewerHandle: null,
      }),
    );

    expect(html).not.toContain("Follow list");
    expect(html).not.toContain("/login?");
  });

  it("uses distinct empty and unavailable states", () => {
    const empty = renderToStaticMarkup(
      createElement(CreatorListsContent, { status: "ready", lists: [] }),
    );
    const unavailable = renderToStaticMarkup(
      createElement(CreatorListsContent, { status: "unavailable", lists: [] }),
    );

    expect(empty).toContain("No creators have shared a list yet.");
    expect(empty).toContain('href="/map"');
    expect(empty).toContain("Find venues on Map");
    expect(unavailable).toContain("We could not reach creator lists.");
    expect(unavailable).toContain("Try again");
    expect(unavailable).not.toContain("No creator lists yet.");
  });

  it("refuses a malformed API body instead of presenting it as an empty market", () => {
    expect(parseCreatorListsResponse({ rows: [] })).toBeNull();
    expect(parseCreatorListsResponse({ status: "degraded", lists: [] })).toBeNull();
    expect(
      parseCreatorListsResponse({
        lists: [{ ownerHandle: "alice", listType: "Broken" }],
      }),
    ).toBeNull();
  });

  it("keeps lists it did read when the lane is degraded", () => {
    expect(
      parseCreatorListsResponse({ status: "degraded", lists: [LIST] }),
    ).toEqual([LIST]);
  });
});

describe("settleCreatorListsResponse", () => {
  function unreadJsonResponse(status: number, body = "{}"): Response {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
        },
      }),
      { status },
    );
  }

  it("lets go of a failed body instead of leaving the request hanging", async () => {
    const response = unreadJsonResponse(503, '{"error":"no"}');
    const result = await settleCreatorListsResponse(response, { aborted: false });

    expect(result).toEqual({ outcome: "unavailable" });
    expect(response.bodyUsed).toBe(true);
  });

  it("does not pin unavailable after a retry aborts a finished failure", async () => {
    const response = unreadJsonResponse(503);
    const result = await settleCreatorListsResponse(response, { aborted: true });

    expect(result).toEqual({ outcome: "aborted" });
    expect(response.bodyUsed).toBe(true);
  });

  it("recovers a ready body after an earlier failure", async () => {
    const failed = await settleCreatorListsResponse(unreadJsonResponse(503), {
      aborted: false,
    });
    const ready = await settleCreatorListsResponse(
      new Response(
        JSON.stringify({ status: "ready", lists: [LIST] }),
        { status: 200 },
      ),
      { aborted: false },
    );

    expect(failed).toEqual({ outcome: "unavailable" });
    expect(ready).toEqual({ outcome: "ready", lists: [LIST] });
  });
});
