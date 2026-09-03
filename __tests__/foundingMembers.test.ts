// The founding-member policy: what a number is, how it reads, and what a
// founding surface is allowed to say. Pure module, so this needs no DOM, no
// network and no database.

import { afterEach, describe, expect, it } from "vitest";

import {
  FOUNDERS_DISCORD_CTA,
  FOUNDERS_WALL_EMPTY,
  FOUNDERS_WALL_LEDE,
  FOUNDERS_WALL_UNAVAILABLE,
  FOUNDERS_WELCOME_SHOWN_KEY,
  FOUNDING_MEMBER_CAP,
  foundersDiscordInviteUrl,
  foundersWelcomeShown,
  foundingMemberMark,
  foundingMemberMarkDetail,
  foundingSlotsRemainingLine,
  isFoundingMemberNumber,
  markFoundersWelcomeShown,
  parseFoundingMemberNumber,
} from "@/lib/foundingMembers";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    read: () => Object.fromEntries(map),
  };
}

const ORIGINAL_INVITE = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;

afterEach(() => {
  if (ORIGINAL_INVITE === undefined) delete process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
  else process.env.NEXT_PUBLIC_DISCORD_INVITE_URL = ORIGINAL_INVITE;
});

describe("what a founding number is", () => {
  it("caps the cohort at a hundred and refuses anything outside it", () => {
    expect(FOUNDING_MEMBER_CAP).toBe(100);
    expect(isFoundingMemberNumber(1)).toBe(true);
    expect(isFoundingMemberNumber(100)).toBe(true);
    expect(isFoundingMemberNumber(0)).toBe(false);
    expect(isFoundingMemberNumber(101)).toBe(false);
    expect(isFoundingMemberNumber(-3)).toBe(false);
    expect(isFoundingMemberNumber(7.5)).toBe(false);
    expect(isFoundingMemberNumber("7")).toBe(false);
    expect(isFoundingMemberNumber(null)).toBe(false);
    expect(isFoundingMemberNumber(undefined)).toBe(false);
  });

  it("reads an untrusted value without guessing", () => {
    expect(parseFoundingMemberNumber(7)).toBe(7);
    expect(parseFoundingMemberNumber("7")).toBe(7);
    expect(parseFoundingMemberNumber(" 42 ")).toBe(42);
    expect(parseFoundingMemberNumber("101")).toBeNull();
    expect(parseFoundingMemberNumber("seven")).toBeNull();
    expect(parseFoundingMemberNumber("7.0")).toBeNull();
    expect(parseFoundingMemberNumber(null)).toBeNull();
    expect(parseFoundingMemberNumber({ number: 7 })).toBeNull();
  });
});

describe("how the mark reads", () => {
  it("says the same sentence for every number and nothing for a non-number", () => {
    expect(foundingMemberMark(1)).toBe("Founding member · No. 1");
    expect(foundingMemberMark(100)).toBe("Founding member · No. 100");
    expect(foundingMemberMark(0)).toBeNull();
    expect(foundingMemberMark(undefined)).toBeNull();
  });

  it("keeps the detail line honest about what the number is worth", () => {
    const detail = foundingMemberMarkDetail(7)!;
    expect(detail).toContain("Number 7");
    expect(detail).toContain("unlocks nothing");
    expect(foundingMemberMarkDetail(999)).toBeNull();
  });

  it("never sells the status with a scarcity line aimed at outsiders", () => {
    // The count is a fact about a public list, not a countdown. It states what
    // is taken; it never tells anybody to hurry.
    for (const line of [
      foundingSlotsRemainingLine(0),
      foundingSlotsRemainingLine(42),
      foundingSlotsRemainingLine(99),
      foundingSlotsRemainingLine(100),
      FOUNDERS_WALL_LEDE,
      FOUNDERS_WALL_EMPTY,
      FOUNDERS_WALL_UNAVAILABLE,
      FOUNDERS_DISCORD_CTA,
    ]) {
      expect(line).not.toMatch(/hurry|last chance|don't miss|missing out|before it/i);
      expect(line).not.toMatch(/[—–]/);
      expect(line).not.toContain("!");
    }
    expect(foundingSlotsRemainingLine(99)).toBe("99 of 100 taken. One number left.");
    expect(foundingSlotsRemainingLine(100)).toBe("All 100 numbers are taken.");
    expect(foundingSlotsRemainingLine(140)).toBe("All 100 numbers are taken.");
  });

  it("promises no capability anywhere in the founding copy", () => {
    for (const line of [FOUNDERS_WALL_LEDE, FOUNDERS_DISCORD_CTA, FOUNDERS_WALL_EMPTY]) {
      expect(line).not.toMatch(/early access to|exclusive|members only|premium|perks include/i);
    }
    expect(FOUNDERS_WALL_LEDE).toMatch(/no perks/i);
    expect(FOUNDERS_WALL_LEDE).toMatch(/nothing is gated/i);
  });
});

describe("the founders' door", () => {
  it("takes the invite from the environment and nowhere else", () => {
    process.env.NEXT_PUBLIC_DISCORD_INVITE_URL = "https://discord.gg/pubmaxx-test-invite";
    expect(foundersDiscordInviteUrl()).toBe("https://discord.gg/pubmaxx-test-invite");
    delete process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
    expect(foundersDiscordInviteUrl()).toBeNull();
  });

  it("refuses anything that is not an https Discord invite", () => {
    for (const bad of [
      "",
      "   ",
      "not a url",
      "http://discord.gg/pubmaxx-test-invite",
      "https://discord.gg",
      "https://discord.gg/",
      "https://disc0rd.gg/r46K8Qv5W",
      "https://evil.example/discord.gg/pubmaxx-test-invite",
      "javascript:alert(1)",
    ]) {
      expect(foundersDiscordInviteUrl(bad)).toBeNull();
    }
    expect(foundersDiscordInviteUrl("https://discord.com/invite/r46K8Qv5W")).toBe(
      "https://discord.com/invite/r46K8Qv5W",
    );
  });
});

describe("the one-shot welcome marker", () => {
  it("shows once for a number and stays quiet after", () => {
    const storage = memoryStorage();
    expect(foundersWelcomeShown(storage, 7)).toBe(false);
    markFoundersWelcomeShown(storage, 7);
    expect(foundersWelcomeShown(storage, 7)).toBe(true);
    expect(storage.read()[FOUNDERS_WELCOME_SHOWN_KEY]).toBe("7");
  });

  it("still welcomes a second founding account on the same browser", () => {
    // The marker holds the NUMBER, not a flag. A flag would have swallowed the
    // second account's own welcome, which is the account-switch defect this
    // codebase has already paid for once.
    const storage = memoryStorage({ [FOUNDERS_WELCOME_SHOWN_KEY]: "7" });
    expect(foundersWelcomeShown(storage, 7)).toBe(true);
    expect(foundersWelcomeShown(storage, 12)).toBe(false);
  });

  it("stays quiet when storage is missing or blocked", () => {
    expect(foundersWelcomeShown(null, 7)).toBe(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(foundersWelcomeShown(blocked, 7)).toBe(true);
    expect(() => markFoundersWelcomeShown(blocked, 7)).not.toThrow();
  });
});
