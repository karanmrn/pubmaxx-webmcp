// The founders wall is public, and until now nothing in the app pointed at it.
//
// It has always been server-rendered at /founders, sitemapped and canonical, so
// the only readers who ever reached it were crawlers. The link is the whole
// feature; the wall itself is unchanged.
//
// The law it must not break is the one lib/foundingMembers.ts states: a
// founding number buys BELONGING and never a capability. So the link may not
// branch on whether the reader holds a number, and it may not carry a count -
// "6 of 100 taken" is a record on the wall and a hurry-up on a link.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  FOUNDERS_WALL_HREF,
  FOUNDERS_WALL_LINK_LABEL,
  FOUNDING_MEMBER_CAP,
} from "@/lib/foundingMembers";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) =>
    createElement("a", { href: String(href), className: String(className ?? "") }, children as never),
}));

import FoundersWallLink from "@/components/founding/FoundersWallLink";

const REPO_ROOT = join(__dirname, "..");

function linkHtml(): string {
  return renderToStaticMarkup(createElement(FoundersWallLink, {}));
}

describe("the founders wall has one way in", () => {
  it("names the wall and goes to it", () => {
    const html = linkHtml();
    expect(html).toContain(`href="${FOUNDERS_WALL_HREF}"`);
    expect(html).toContain(FOUNDERS_WALL_LINK_LABEL);
  });

  it("carries no count, and no hurry", () => {
    const html = linkHtml();
    expect(html).not.toContain(String(FOUNDING_MEMBER_CAP));
    expect(html).not.toMatch(/taken|left|remaining|hurry|claim yours/i);
  });

  it("reads nothing about the viewer", () => {
    const source = readFileSync(
      join(REPO_ROOT, "components/founding/FoundersWallLink.tsx"),
      "utf8",
    );
    // Branching on the number would make it a capability, which is the one
    // thing the founding-member law forbids outright.
    expect(source).not.toContain("useFoundingMembership");
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain("useViewerHandle");
  });
});

describe("both surfaces use the one component", () => {
  const surfaces = [
    "app/social/SocialPageClient.tsx",
    "components/profile/PubmaxxAccountHub.tsx",
  ];

  it("mounts the shared link rather than a hand-written anchor", () => {
    for (const surface of surfaces) {
      const source = readFileSync(join(REPO_ROOT, surface), "utf8");
      expect(source, surface).toContain("<FoundersWallLink");
      expect(source, surface).not.toContain('href="/founders"');
    }
  });

  it("keeps the wall out of the founding member's own card", () => {
    // The card is for a founding member alone; the wall is for everybody.
    const card = readFileSync(
      join(REPO_ROOT, "components/founding/FoundingMemberCard.tsx"),
      "utf8",
    );
    expect(card).not.toContain("FoundersWallLink");
  });
});
