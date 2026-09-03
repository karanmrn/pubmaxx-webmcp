// What the new surfaces render, and what they refuse to render.
//
// Three separate promises are pinned here:
//  1. Crews are behind the Social gate. With PUBMAX_SOCIAL_FRIENDS_LAUNCH off,
//     nothing user-reachable about a crew may exist on any page.
//  2. The follow control says where a friendship stands, so "Mates" and
//     "Following" are never the same pixels.
//  3. A profile statistic is a way in, not a number in a box.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => new Response("{}", { status: 403 }),
  authedActionFetch: async () => new Response("{}", { status: 403 }),
}));

import CrewsPanel from "@/components/social/CrewsPanel";
import FollowButton from "@/components/profile/FollowButton";
import ProfileHeader from "@/components/profile/ProfileHeader";
import type { Profile, ProfileStats } from "@/lib/profiles";

const socialPageClient = readFileSync(
  join(process.cwd(), "app/social/SocialPageClient.tsx"),
  "utf8",
);
const profileClient = readFileSync(
  join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
  "utf8",
);
const foundingMembershipHook = readFileSync(
  join(process.cwd(), "components/founding/useFoundingMembership.ts"),
  "utf8",
);
const crewDetailClient = readFileSync(
  join(process.cwd(), "app/social/crews/[crewId]/CrewDetailClient.tsx"),
  "utf8",
);

describe("crews stay behind the Social gate", () => {
  it("waits for the live identity answer before checking Social access", () => {
    expect(socialPageClient).toContain("identityResolved");
    expect(socialPageClient).toMatch(/if \(initialState\.tab === "discover"\)/);
    expect(foundingMembershipHook).toMatch(/if \(!userId \|\| !identityResolved\)/);
    expect(crewDetailClient).toContain("identityResolved");
    expect(crewDetailClient).toMatch(/if \(!identityResolved\) return;/);
  });

  it("renders a neutral skeleton while its viewer identity resolves", () => {
    const html = renderToStaticMarkup(
      createElement(CrewsPanel, { resolveAccess: true }),
    );
    expect(html).toContain("socialIdentitySkeletons");
    expect(html).toContain("Loading your crews");
    expect(html).not.toContain("Try again");
  });

  it("mounts on /social only inside the verified branch", () => {
    // The composer stays behind verified access. The crew card may render its
    // own neutral identity state before that answer lands.
    expect(socialPageClient).toMatch(
      /showViewerCards \? \(\s*<CrewsPanel/,
    );
    const signedOut = socialPageClient.match(
      /viewerPhase === "signed-out" \? \([\s\S]*?\) : access === "checking"/,
    )?.[0];
    expect(signedOut, "signed-out boundary present").toBeTruthy();
    expect(signedOut).toContain("SocialAccessBoundary");
    expect(signedOut).not.toMatch(/CrewsPanel|PeopleDirectory/);
    // Friend formation itself rides the rail on `isPosts` alone, with no access
    // gate in front of it. A crew may never join it there either.
    const friendFormation = socialPageClient
      .split("\n")
      .filter((line) => line.includes("isPosts ?"));
    expect(friendFormation.length).toBeGreaterThan(0);
    for (const line of friendFormation) expect(line).not.toMatch(/CrewsPanel/);
  });

  it("asks the gate itself wherever no parent already did", () => {
    expect(profileClient).toMatch(/<CrewsPanel[\s\S]{0,120}resolveAccess/);
  });

  it("reads the launch flag through Social access, never through the browser", () => {
    // Code only. A comment may name the flag to explain the rule; the same
    // split the we-are-out fence uses.
    const code = (source: string) =>
      source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
    for (const source of [
      readFileSync(join(process.cwd(), "components/social/CrewsPanel.tsx"), "utf8"),
      readFileSync(
        join(process.cwd(), "app/social/crews/[crewId]/CrewDetailClient.tsx"),
        "utf8",
      ),
    ]) {
      expect(code(source)).not.toMatch(/process\.env/);
      expect(code(source)).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
      expect(source).not.toContain("—");
    }
  });
});

describe("the follow control says where the friendship stands", () => {
  function markup(props: {
    initialFollowing: boolean;
    followsViewer?: boolean;
  }): string {
    return renderToStaticMarkup(
      createElement(FollowButton, {
        targetHandle: "sam",
        followerHandle: "alice",
        ...props,
      }),
    );
  }

  it("calls a two-sided follow Mates, and says so", () => {
    const html = markup({ initialFollowing: true, followsViewer: true });
    expect(html).toContain("Mates");
    expect(html).toContain("You follow each other");
  });

  it("keeps a one-sided follow honestly one-sided", () => {
    const html = markup({ initialFollowing: true, followsViewer: false });
    expect(html).toContain("Following");
    expect(html).not.toContain("Mates");
    expect(html).toMatch(/not followed back/);
  });

  it("shows a pending mate the follow-back move and names the hint", () => {
    const html = markup({ initialFollowing: false, followsViewer: true });
    expect(html).toContain("Follow back");
    expect(html).toContain("Follows you");
  });

  it("says nothing extra when there is no edge either way", () => {
    const html = markup({ initialFollowing: false });
    expect(html).toContain(">Follow<");
    expect(html).not.toContain("Follows you");
    expect(html).not.toContain("Mates");
  });

  it("carries what the tap does in the accessible name", () => {
    expect(markup({ initialFollowing: true, followsViewer: true })).toMatch(
      /aria-label="[^"]*no longer be mates/,
    );
  });

  it("still defaults to the old one-edge behaviour when nobody passes the mirror", () => {
    // The prop is optional so every existing caller keeps compiling; the
    // default must be the cautious one, never a claimed mutual.
    expect(markup({ initialFollowing: true })).not.toContain("Mates");
  });
});

describe("profile statistics are ways in", () => {
  const profile: Profile = {
    handle: "sam",
    displayName: "Sam",
    homeCity: "London",
    bio: "",
    avatarUrl: "",
    coverUrl: "",
  } as Profile;

  const stats: ProfileStats = {
    pintsLogged: 12,
    cheapestPintGbp: 4.2,
    pubsVisited: 5,
    boroughs: [],
    beers: 3,
  } as unknown as ProfileStats;

  const html = renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile,
      stats,
      followers: 14,
      following: 9,
      crawls: 3,
      memories: 2,
    }),
  );

  it("links every one of the six tiles", () => {
    const tiles = html.match(/class="profileStat"/g) ?? [];
    const links = html.match(/class="profileStatLink"/g) ?? [];
    expect(tiles).toHaveLength(6);
    expect(links).toHaveLength(6);
  });

  it("points each tile at the surface that holds what it counts", () => {
    expect(html).toContain('href="/u/sam/people/followers"');
    expect(html).toContain('href="/u/sam/people/following"');
    expect(html).toContain('href="/u/sam#timeline"');
    expect(html).toContain('href="/u/sam#crawl-stories"');
    expect(html).toContain('href="/u/sam#night-memories"');
  });

  it("says where a tile goes in its accessible name, since a bare figure cannot", () => {
    expect(html).toMatch(/aria-label="Followers: 14\. See who follows this handle\."/);
    expect(html).toMatch(/aria-label="Pints logged: 12\./);
  });

  it("keeps the label and the figure as the only visible text", () => {
    expect(html).toContain(
      '<span class="profileStatLabel">Followers</span><strong class="profileStatValue">14</strong>',
    );
  });
});
