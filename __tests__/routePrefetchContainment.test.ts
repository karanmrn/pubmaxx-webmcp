import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const entrySurfaces = [
  "components/nav/SiteNav.tsx",
  "components/nav/NowSegment.tsx",
  "components/landing/LandingPage.tsx",
  "components/landing/ThamesHero.tsx",
  "app/today/TodayClient.tsx",
  "app/tonight/TonightClient.tsx",
  "app/out/OutClient.tsx",
];

describe("entry-route prefetch containment", () => {
  it.each(entrySurfaces)("keeps automatic route prefetch off %s", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    const openingTags = source.match(/<Link\b[\s\S]*?>/g) ?? [];

    expect(openingTags.length).toBeGreaterThan(0);
    for (const tag of openingTags) expect(tag).toContain("prefetch={false}");
  });
});
