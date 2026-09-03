// A starter pack may only ever contain people who are already here.
//
// Everything below is one claim in four parts: a pack is built from real
// claimed accounts, a deleted account leaves it, a pack too thin to be an
// introduction does not show at all, and a borough pack places somebody only
// where their own public words placed them. There is no seeded member, no house
// account and no inferred borough anywhere in this policy, and these cases are
// what stops one appearing later.

import { describe, expect, it } from "vitest";

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import {
  FOUNDING_STARTER_PACK_SLUG,
  STARTER_PACK_MAX_MEMBERS,
  STARTER_PACK_MEMBER_FLOOR,
  listStarterPacks,
  locationNamesBorough,
  selectBoroughPackMembers,
  selectFoundingPackMembers,
  selectStarterPackMembers,
  starterPackBySlug,
  starterPackFollowSummary,
  starterPackMemberCountLabel,
  starterPackShows,
  viewerNeedsStarterPacks,
  type StarterPackCandidate,
  type StarterPackFollowResult,
} from "@/lib/starterPacks";

function candidate(
  handle: string,
  overrides: Partial<StarterPackCandidate> = {},
): StarterPackCandidate {
  return {
    handle,
    claimed: true,
    tombstoned: false,
    ...overrides,
  };
}

describe("which packs exist", () => {
  it("offers the founders plus one pack per London borough, founders first", () => {
    const packs = listStarterPacks();
    expect(packs).toHaveLength(LONDON_BOROUGHS.length + 1);
    expect(packs[0]?.slug).toBe(FOUNDING_STARTER_PACK_SLUG);
    expect(packs[0]?.kind).toBe("founding");
    expect(packs.filter((pack) => pack.kind === "borough")).toHaveLength(
      LONDON_BOROUGHS.length,
    );
  });

  it("gives every pack a unique slug, a title and a one-line rule", () => {
    const packs = listStarterPacks();
    expect(new Set(packs.map((pack) => pack.slug)).size).toBe(packs.length);
    for (const pack of packs) {
      expect(pack.slug).toMatch(/^[a-z0-9-]+$/);
      expect(pack.title.length).toBeGreaterThan(0);
      expect(pack.description.length).toBeGreaterThan(0);
      expect(pack.description).not.toContain("\n");
    }
  });

  it("names a borough pack after its borough, and the City after the City", () => {
    expect(starterPackBySlug("camden")?.title).toBe("Drinkers of Camden");
    expect(starterPackBySlug("hackney")?.title).toBe("Drinkers of Hackney");
    expect(starterPackBySlug(slugifyBorough("City of London"))?.title).toBe(
      "Drinkers of the City",
    );
  });

  it("resolves a slug to its pack and refuses a slug no pack owns", () => {
    expect(starterPackBySlug("tower-hamlets")?.borough).toBe("Tower Hamlets");
    expect(starterPackBySlug(FOUNDING_STARTER_PACK_SLUG)?.kind).toBe("founding");
    expect(starterPackBySlug("shoreditch")).toBeNull();
    expect(starterPackBySlug("")).toBeNull();
  });
});

describe("a borough pack reads the owner's own words", () => {
  it("matches the borough named anywhere in the location text", () => {
    expect(locationNamesBorough("Camden", "Camden")).toBe(true);
    expect(locationNamesBorough("Camden Town, London", "Camden")).toBe(true);
    expect(locationNamesBorough("London / camden", "Camden")).toBe(true);
    expect(locationNamesBorough("London Borough of Hackney", "Hackney")).toBe(true);
  });

  it("reads an ampersand as the word the borough name uses", () => {
    expect(
      locationNamesBorough("Kensington & Chelsea", "Kensington and Chelsea"),
    ).toBe(true);
  });

  it("accepts a borough's own shorter name and never a district inside it", () => {
    expect(locationNamesBorough("Kingston", "Kingston upon Thames")).toBe(true);
    expect(locationNamesBorough("Richmond", "Richmond upon Thames")).toBe(true);
    // Fulham is a place inside Hammersmith and Fulham, not another name for it.
    expect(locationNamesBorough("Fulham", "Hammersmith and Fulham")).toBe(false);
  });

  it("never matches inside a word, and never guesses from a vague location", () => {
    expect(locationNamesBorough("Camberwell", "Camden")).toBe(false);
    expect(locationNamesBorough("north london", "Camden")).toBe(false);
    expect(locationNamesBorough("London", "Camden")).toBe(false);
    expect(locationNamesBorough("", "Camden")).toBe(false);
    expect(locationNamesBorough(undefined, "Camden")).toBe(false);
  });
});

describe("who a pack may contain", () => {
  it("takes only accounts their own location placed in the borough", () => {
    const members = selectBoroughPackMembers(
      [
        candidate("ada", { homeCity: "Camden" }),
        candidate("bex", { homeCity: "Camden Town" }),
        candidate("cal", { homeCity: "Hackney" }),
        candidate("dee", {}),
      ],
      "Camden",
    );
    expect(members.map((member) => member.handle)).toEqual(["ada", "bex"]);
  });

  it("never invents a member from an empty account list", () => {
    expect(selectBoroughPackMembers([], "Camden")).toEqual([]);
    expect(selectFoundingPackMembers([])).toEqual([]);
  });

  it("drops an unclaimed handle: a row nobody owns is not a person", () => {
    const members = selectBoroughPackMembers(
      [
        candidate("ada", { homeCity: "Camden" }),
        candidate("ghost", { homeCity: "Camden", claimed: false }),
      ],
      "Camden",
    );
    expect(members.map((member) => member.handle)).toEqual(["ada"]);
  });

  it("drops a tombstoned account from a borough pack and the founders alike", () => {
    const gone = candidate("gone", {
      homeCity: "Camden",
      foundingMemberNumber: 2,
      tombstoned: true,
    });
    expect(
      selectBoroughPackMembers([candidate("ada", { homeCity: "Camden" }), gone], "Camden"),
    ).toHaveLength(1);
    expect(
      selectFoundingPackMembers([
        candidate("ada", { foundingMemberNumber: 1 }),
        gone,
      ]).map((member) => member.handle),
    ).toEqual(["ada"]);
  });

  it("orders a borough pack by handle so everybody opens the same pack", () => {
    const members = selectBoroughPackMembers(
      [
        candidate("zed", { homeCity: "Camden" }),
        candidate("ada", { homeCity: "Camden" }),
        candidate("mo", { homeCity: "Camden" }),
      ],
      "Camden",
    );
    expect(members.map((member) => member.handle)).toEqual(["ada", "mo", "zed"]);
  });

  it("orders the founders by number and keeps the gaps a departure leaves", () => {
    const members = selectFoundingPackMembers([
      candidate("cal", { foundingMemberNumber: 9 }),
      candidate("ada", { foundingMemberNumber: 1 }),
      candidate("bex", { foundingMemberNumber: 4 }),
      candidate("nobody", {}),
    ]);
    expect(members.map((member) => member.foundingMemberNumber)).toEqual([1, 4, 9]);
  });

  it("caps one tap at a dozen accounts", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      candidate(`drinker${String(index).padStart(2, "0")}`, { homeCity: "Camden" }),
    );
    expect(selectBoroughPackMembers(many, "Camden")).toHaveLength(
      STARTER_PACK_MAX_MEMBERS,
    );
  });

  it("dispatches a pack to its own rule and never crosses the two", () => {
    const candidates = [
      candidate("ada", { homeCity: "Camden", foundingMemberNumber: 1 }),
      candidate("bex", { homeCity: "Hackney", foundingMemberNumber: 2 }),
    ];
    const camden = starterPackBySlug("camden")!;
    const founders = starterPackBySlug(FOUNDING_STARTER_PACK_SLUG)!;
    expect(selectStarterPackMembers(camden, candidates).map((m) => m.handle)).toEqual([
      "ada",
    ]);
    expect(selectStarterPackMembers(founders, candidates).map((m) => m.handle)).toEqual([
      "ada",
      "bex",
    ]);
  });

  it("carries the founding mark onto a member and nothing private with it", () => {
    const [member] = selectFoundingPackMembers([
      candidate("ada", {
        foundingMemberNumber: 3,
        displayName: "Ada",
        avatarUrl: "/api/avatar/id/2",
      }),
    ]);
    expect(member).toEqual({
      handle: "ada",
      displayName: "Ada",
      avatarUrl: "/api/avatar/id/2",
      foundingMemberNumber: 3,
    });
  });
});

describe("a thin pack does not show", () => {
  it("hides a pack below the floor and shows one that reaches it", () => {
    expect(STARTER_PACK_MEMBER_FLOOR).toBe(3);
    expect(starterPackShows(0)).toBe(false);
    expect(starterPackShows(1)).toBe(false);
    expect(starterPackShows(2)).toBe(false);
    expect(starterPackShows(3)).toBe(true);
    expect(starterPackShows(12)).toBe(true);
  });
});

describe("who gets offered the packs", () => {
  it("offers them to somebody short of a lot", () => {
    expect(viewerNeedsStarterPacks(0)).toBe(true);
    expect(viewerNeedsStarterPacks(1)).toBe(true);
    expect(viewerNeedsStarterPacks(2)).toBe(true);
  });

  it("leaves somebody with a lot alone", () => {
    expect(viewerNeedsStarterPacks(3)).toBe(false);
    expect(viewerNeedsStarterPacks(40)).toBe(false);
  });

  it("stays quiet when the follow count did not answer", () => {
    // A read that could not answer may never tell a drinker they have nobody.
    expect(viewerNeedsStarterPacks(null)).toBe(false);
  });
});

describe("what a follow-all is allowed to claim", () => {
  function results(
    ...outcomes: StarterPackFollowResult["outcome"][]
  ): StarterPackFollowResult[] {
    return outcomes.map((outcome, index) => ({
      handle: `drinker${index}`,
      outcome,
    }));
  }

  it("counts an account already followed as followed, because it is", () => {
    expect(starterPackFollowSummary(results("followed", "already", "followed"))).toBe(
      "Following all 3.",
    );
  });

  it("names the number that did not go through rather than rounding up", () => {
    expect(starterPackFollowSummary(results("followed", "failed", "followed"))).toBe(
      "Following 2 of 3. 1 didn't go through.",
    );
  });

  it("names a member who is gone rather than calling it a failure", () => {
    expect(
      starterPackFollowSummary(results("followed", "unavailable", "followed")),
    ).toBe("Following 2 of 3. 1 is no longer here.");
    expect(
      starterPackFollowSummary(results("followed", "unavailable", "failed", "unavailable")),
    ).toBe("Following 1 of 4. 1 didn't go through. 2 are no longer here.");
  });

  it("says so plainly when none of it went through", () => {
    expect(starterPackFollowSummary(results("failed", "failed"))).toBe(
      "That didn't go through. Try again.",
    );
  });

  it("does not print Following 0 of N when every member is gone", () => {
    expect(starterPackFollowSummary(results("unavailable", "unavailable"))).toBe(
      "2 are no longer here.",
    );
  });

  it("does not count the viewer's own handle as somebody they followed", () => {
    expect(starterPackFollowSummary(results("self", "followed"))).toBe(
      "Following all 1.",
    );
    expect(starterPackFollowSummary(results("self"))).toBe("Nobody here to follow yet.");
  });

  it("counts members in words a reader can check against the faces", () => {
    expect(starterPackMemberCountLabel(1)).toBe("1 account");
    expect(starterPackMemberCountLabel(7)).toBe("7 accounts");
  });
});
