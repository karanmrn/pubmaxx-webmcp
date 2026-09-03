import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("avatar render fan-out (representative surfaces)", () => {
  it("FeedCard wires HandleAvatar for drops, spills, and check-ins", () => {
    const source = read("components/feed/FeedCard.tsx");
    expect(source).toContain('import HandleAvatar from "@/components/profile/HandleAvatar"');
    expect(source).toContain("avatarUrl={item.avatarUrl}");
    expect(source).toContain("avatarUrl={avatarUrl}");
    expect(source).not.toMatch(/feedAvatar" aria-hidden/);
  });

  it("SocialPostCard and ContributorRecord show handle avatars with fallback", () => {
    const social = read("app/social/SocialPageClient.tsx");
    expect(social).toContain("avatarUrl={post.author.avatarUrl}");

    const contributors = read("components/contributors/ContributorRecord.tsx");
    expect(contributors).toContain("avatarUrl={entry.avatarUrl}");

    const handleAvatar = read("components/profile/HandleAvatar.tsx");
    expect(handleAvatar).toContain('setFailedUrl(avatarUrl ?? null)');
    expect(handleAvatar).toContain("{initial}");
  });
});
