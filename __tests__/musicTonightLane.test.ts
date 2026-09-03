import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("MusicTonightLane (W4)", () => {
  const source = readFileSync(
    join(process.cwd(), "components/discovery/MusicTonightLane.tsx"),
    "utf8",
  );

  it("consumes the music what's-on spine with thin-coverage honesty", () => {
    expect(source).toMatch(/\/api\/whats-on\?kind=music/);
    expect(source).toMatch(/Thin coverage tonight/);
    expect(source).toMatch(/THIN_COVERAGE_MAX/);
    expect(source).not.toMatch(/\u2014/);
  });

  // This lane is about ONE source. The page-level stamp reports the freshest
  // thing the whole answer can show, and the deals feed is rebuilt far more
  // often than the music one, so a lane that took the page's date would claim
  // gigs were confirmed on a day nobody looked at a gig listing.
  it("dates itself from the music source, never from the page", () => {
    expect(source).toMatch(/kindObservedAt/);
    const host = readFileSync(join(process.cwd(), "app/tonight/TonightClient.tsx"), "utf8");
    expect(host).toMatch(/<MusicTonightLane[^>]*asOf=\{kindObservedAt\.music\}/);
    expect(host).not.toMatch(/<MusicTonightLane[^>]*asOf=\{asOf\}/);
  });
});

describe("TonightMapPointer (W1 Discover absorb)", () => {
  const source = readFileSync(
    join(process.cwd(), "components/discovery/TonightMapPointer.tsx"),
    "utf8",
  );

  it("points Discover at the map Tonight lane instead of CityMCP", () => {
    expect(source).toMatch(/\/map\?src=discover-tonight/);
    expect(source).toMatch(/whats_on_filter/);
  });
});
