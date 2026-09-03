// The packs are OFFERED to a drinker who has nobody yet, and to nobody else.
//
// The gate has four parts and only one owner (`starterPacksSurfaceVisible`), so
// this file pins the rule where it lives and then proves the component asks it
// rather than keeping a second copy. A second copy is precisely how a surface
// starts pushing starter packs at somebody with a full lot, or paints packs
// from a read that has not answered.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { isSocialFriendsLaunchEnabled } from "@/lib/socialLaunch";
import {
  STARTER_PACK_FOLLOW_FLOOR,
  STARTER_PACK_FOLLOW_OUTCOMES,
  starterPacksSurfaceVisible,
  type StarterPackFollowOutcome,
} from "@/lib/starterPacks";

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => new Response("{}", { status: 503 }),
  authedActionFetch: async () => new Response("{}", { status: 503 }),
}));

const viewerState = vi.hoisted(() => ({ handle: null as string | null }));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => viewerState.handle,
}));

const SOURCE = readFileSync(
  join(process.cwd(), "components/social/StarterPacks.tsx"),
  "utf8",
);

/**
 * Code only. A comment may name the rule to explain it; the same split the
 * crews-and-people fence uses.
 */
const CODE = SOURCE.split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

function visible(overrides: Partial<Parameters<typeof starterPacksSurfaceVisible>[0]>) {
  return starterPacksSurfaceVisible({
    viewer: "zed",
    loaded: true,
    packCount: 2,
    viewerFollowing: 0,
    followedAny: false,
    ...overrides,
  });
}

describe("the fewer-than-three-follows gate", () => {
  it("offers the packs to a drinker following fewer than three accounts", () => {
    expect(STARTER_PACK_FOLLOW_FLOOR).toBe(3);
    expect(visible({ viewerFollowing: 0 })).toBe(true);
    expect(visible({ viewerFollowing: 1 })).toBe(true);
    expect(visible({ viewerFollowing: 2 })).toBe(true);
  });

  it("stays out of the way once the drinker has a lot", () => {
    expect(visible({ viewerFollowing: 3 })).toBe(false);
    expect(visible({ viewerFollowing: 25 })).toBe(false);
  });

  it("renders nothing when the follow count could not answer", () => {
    // Null is "nobody asked, or the read failed". Reading that as zero would
    // push packs at a drinker who already has a lot.
    expect(visible({ viewerFollowing: null })).toBe(false);
  });

  it("renders nothing before the live session names the viewer", () => {
    expect(visible({ viewer: null })).toBe(false);
  });

  it("renders nothing before the read answers, and nothing with no packs", () => {
    expect(visible({ loaded: false })).toBe(false);
    expect(visible({ packCount: 0 })).toBe(false);
  });

  it("stays up after a follow-all, because it is reporting what the tap did", () => {
    expect(visible({ viewerFollowing: 0, followedAny: true })).toBe(true);
    // The count that arrived with the page is already stale by then.
    expect(visible({ viewerFollowing: 12, followedAny: true })).toBe(true);
  });
});

describe("the component asks the one gate", () => {
  it("calls the shared gate and keeps no second copy of the floor", () => {
    expect(CODE).toMatch(/starterPacksSurfaceVisible\(/);
    expect(CODE).not.toMatch(/STARTER_PACK_FOLLOW_FLOOR/);
    expect(CODE).not.toMatch(/viewerFollowing\s*[<>]/);
  });

  it("takes its title, labels and count words from the policy module", () => {
    expect(SOURCE).toMatch(/STARTER_PACKS_TITLE/);
    expect(SOURCE).toMatch(/STARTER_PACK_FOLLOW_LABEL/);
    expect(SOURCE).toMatch(/starterPackMemberCountLabel\(/);
    expect(SOURCE).toMatch(/STARTER_PACK_PREVIEW_FACES/);
  });

  it("shows the pack's one-line rule to a screen reader without printing a subtitle", () => {
    // The description is the accessible description of a button that follows a
    // dozen people at once, never descriptive copy under the card title.
    expect(SOURCE).toMatch(/aria-describedby=\{descriptionId\}/);
    expect(SOURCE).toMatch(/className="srOnly"/);
  });
});

describe("the friends-launch flag", () => {
  it("is not read by the packs, so they render the same either side of the flip", () => {
    // Forming the friend graph stays available while posts are gated, which is
    // why `FindYourLot` sits beside the packs in the same aside. A pack that
    // read the flag would be a second gate nobody asked for.
    expect(CODE).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
    expect(CODE).not.toMatch(/process\.env/);
  });

  it("keeps Social live by default and supports explicit rollback", () => {
    expect(isSocialFriendsLaunchEnabled(undefined)).toBe(true);
    expect(isSocialFriendsLaunchEnabled("")).toBe(true);
    expect(isSocialFriendsLaunchEnabled("0")).toBe(false);
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^PUBMAX_SOCIAL_FRIENDS_LAUNCH=\s*$/m);
  });
});

describe("what a member's chip says after the tap", () => {
  async function chip(outcome: StarterPackFollowOutcome) {
    const { starterPackOutcomeChip } = await import(
      "@/components/social/StarterPacks"
    );
    return starterPackOutcomeChip(outcome);
  }

  it("never reads a refused member as a follow that happened", async () => {
    // The write refuses a member who is gone (lib/followWrite.server.ts), and
    // that outcome reaching the chip unhandled printed "Following".
    expect(await chip("unavailable")).toEqual({
      label: "No longer here",
      problem: true,
    });
  });

  it("keeps a live member's chip unchanged, and a fault its own word", async () => {
    expect(await chip("followed")).toEqual({ label: "Following", problem: false });
    expect(await chip("already")).toEqual({ label: "Following", problem: false });
    expect(await chip("self")).toEqual({ label: "You", problem: false });
    expect(await chip("failed")).toEqual({
      label: "Didn't go through",
      problem: true,
    });
  });

  it("says something about every outcome the write can answer", async () => {
    for (const outcome of STARTER_PACK_FOLLOW_OUTCOMES) {
      expect((await chip(outcome)).label.length).toBeGreaterThan(0);
    }
  });
});

describe("nothing paints before the read answers", () => {
  it("renders empty markup for a viewer the session has not named", async () => {
    viewerState.handle = null;
    const { default: StarterPacks } = await import(
      "@/components/social/StarterPacks"
    );
    expect(renderToStaticMarkup(createElement(StarterPacks))).toBe("");
  });

  it("renders empty markup for a named viewer whose read has not answered", async () => {
    viewerState.handle = "zed";
    const { default: StarterPacks } = await import(
      "@/components/social/StarterPacks"
    );
    expect(renderToStaticMarkup(createElement(StarterPacks))).toBe("");
  });
});
