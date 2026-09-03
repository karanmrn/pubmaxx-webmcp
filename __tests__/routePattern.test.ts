import { describe, expect, it } from "vitest";

import { ROUTE_PATTERN_OTHER, toRoutePattern } from "@/lib/routePattern";

describe("toRoutePattern", () => {
  it("maps the root", () => {
    expect(toRoutePattern("/")).toBe("/");
  });

  it("collapses dynamic ids/slugs/handles to their template", () => {
    expect(toRoutePattern("/plan/11111111-1111-4111-8111-111111111111")).toBe("/plan/[id]");
    expect(toRoutePattern("/plan/abc-123/recap")).toBe("/plan/[id]/recap");
    expect(toRoutePattern("/borough/soho")).toBe("/borough/[slug]");
    expect(toRoutePattern("/map/manchester")).toBe("/map/[city]");
    expect(toRoutePattern("/u/dave/lists/saved")).toBe("/u/[handle]/lists/[listType]");
  });

  it("keeps static routes exact", () => {
    expect(toRoutePattern("/pal/chat")).toBe("/pal/chat");
    expect(toRoutePattern("/tonight")).toBe("/tonight");
    expect(toRoutePattern("/near/")).toBe("/near");
    expect(toRoutePattern("/social?feed=nearby&area=camden")).toBe("/social");
  });

  it("strips query and hash before matching", () => {
    expect(toRoutePattern("/plan/xyz?vibe=big#top")).toBe("/plan/[id]");
  });

  it("never leaks an unknown path — falls back to /other", () => {
    expect(toRoutePattern("/secret/1234")).toBe(ROUTE_PATTERN_OTHER);
    expect(toRoutePattern("/plan/a/b/c/d")).toBe(ROUTE_PATTERN_OTHER);
    expect(toRoutePattern("/u/dave/lists/saved/extra")).toBe(ROUTE_PATTERN_OTHER);
  });
});
