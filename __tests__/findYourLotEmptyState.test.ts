// WP7 empty rooms point to Find your lot (search + invites), never a dead end.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const board = readFileSync(
  join(process.cwd(), "components/profile/OutTonightBoard.tsx"),
  "utf8",
);
const feed = readFileSync(
  join(process.cwd(), "app/feed/FeedPageClient.tsx"),
  "utf8",
);
const social = readFileSync(
  join(process.cwd(), "app/social/SocialPageClient.tsx"),
  "utf8",
);
const hub = readFileSync(
  join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
  "utf8",
);
const findLot = readFileSync(
  join(process.cwd(), "components/social/FindYourLot.tsx"),
  "utf8",
);

describe("WP7 find-your-lot empty-state pins", () => {
  it("OutTonightBoard empty state links to /social Find your lot", () => {
    expect(board).toMatch(/Find your lot/);
    expect(board).toMatch(/href="\/social"/);
    expect(board).toMatch(/search handles or send an invite/);
  });

  it("friends feed empty state CTAs to Find your lot", () => {
    expect(feed).toMatch(/Find your lot/);
    expect(feed).toMatch(/href="\/social"/);
    expect(feed).toMatch(/Your lot is quiet/);
  });

  it("Social page mounts FindYourLot even when posts stay gated", () => {
    expect(social).toMatch(/isPosts \? <FindYourLot/);
    expect(social).toMatch(/Friend-graph formation rides the posts tab/);
    expect(findLot).toMatch(/\/api\/profiles\/search/);
    expect(findLot).toMatch(/Find your lot/);
    expect(findLot).not.toMatch(/Open Social/);
  });

  it("You-page account hub mounts FindYourLot", () => {
    expect(hub).toMatch(/FindYourLot/);
  });
});
