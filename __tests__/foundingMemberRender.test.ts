// What a founding member is shown, and what everybody else is shown, which is
// nothing.
//
// The captain's rule has two halves and only one of them is about founders:
//   1. A founding member sees a quiet mark on their card and one door.
//   2. A person who is not one sees NO founding surface at all. Not a greyed
//      link, not a "you missed it" line, not a counter. A status that buys
//      belonging must not be advertised at the people it excludes.
//
// The invite itself never appears in a component. It comes from the environment
// through `lib/foundingMembers.ts`, and the last case here sweeps the tree to
// keep it that way.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const membershipState = vi.hoisted(() => ({
  value: { state: "loading", number: null } as
    | { state: "loading"; number: null }
    | { state: "member"; number: number }
    | { state: "outsider"; number: null },
}));

vi.mock("@/components/founding/useFoundingMembership", () => ({
  useFoundingMembership: () => membershipState.value,
}));

import FoundersDiscordLink from "@/components/founding/FoundersDiscordLink";
import FoundingMemberCard from "@/components/founding/FoundingMemberCard";
import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { FOUNDERS_DISCORD_CTA } from "@/lib/foundingMembers";
import type { Profile, ProfileStats } from "@/lib/profiles";

const ROOT = process.cwd();
const INVITE = "https://discord.gg/pubmaxx-test-invite";

/** React escapes quotes in text nodes, so the markup carries entities. */
function escaped(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const STATS: ProfileStats = {
  pintsLogged: 3,
  cheapestPintGbp: 4.8,
  crawlsPosted: 0,
  memoriesPosted: 0,
};

function card(profile: Partial<Profile>): string {
  return renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile: { handle: "alice", displayName: "Alice Fennimore", ...profile },
      stats: STATS,
    }),
  );
}

const ORIGINAL_INVITE = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL = INVITE;
  membershipState.value = { state: "loading", number: null };
});

afterEach(() => {
  if (ORIGINAL_INVITE === undefined) delete process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
  else process.env.NEXT_PUBLIC_DISCORD_INVITE_URL = ORIGINAL_INVITE;
});

describe("the mark on a public profile card", () => {
  it("prints the number beside the name for a founding member", () => {
    const markup = card({ foundingMemberNumber: 7 });
    expect(markup).toContain("foundingMark");
    expect(markup).toContain("Founding member · No. 7");
  });

  it("prints nothing at all for an ordinary account", () => {
    const markup = card({});
    expect(markup).not.toContain("foundingMark");
    expect(markup).not.toContain("Founding member");
  });

  it("prints nothing for a number outside the cohort", () => {
    expect(card({ foundingMemberNumber: 0 })).not.toContain("foundingMark");
    expect(card({ foundingMemberNumber: 101 })).not.toContain("foundingMark");
  });

  it("does not join the earned-badge ladder, which is about what people did", () => {
    const markup = card({ foundingMemberNumber: 7 });
    const marks = markup.indexOf("foundingMark");
    const badges = markup.indexOf("profileBadges");
    expect(marks).toBeGreaterThan(-1);
    // The mark sits in the identity block, above the badge row when one exists.
    if (badges > -1) expect(marks).toBeLessThan(badges);
  });

  it("renders standalone for any valid number and nothing for junk", () => {
    expect(renderToStaticMarkup(createElement(FoundingMemberMark, { number: 100 })))
      .toContain("Founding member · No. 100");
    expect(renderToStaticMarkup(createElement(FoundingMemberMark, { number: null })))
      .toBe("");
    expect(renderToStaticMarkup(createElement(FoundingMemberMark, { number: undefined })))
      .toBe("");
  });
});

describe("the founders' door on You", () => {
  it("opens for a founding member", () => {
    membershipState.value = { state: "member", number: 3 };
    const markup = renderToStaticMarkup(createElement(FoundingMemberCard));
    expect(markup).toContain("Founding member · No. 3");
    expect(markup).toContain(escaped(FOUNDERS_DISCORD_CTA));
    expect(markup).toContain(INVITE);
  });

  it("shows a non-founding account nothing whatsoever", () => {
    membershipState.value = { state: "outsider", number: null };
    const markup = renderToStaticMarkup(createElement(FoundingMemberCard));
    expect(markup).toBe("");
    expect(markup).not.toContain("Discord");
    expect(markup).not.toContain("Founding");
  });

  it("shows nothing while the live session is still answering", () => {
    membershipState.value = { state: "loading", number: null };
    expect(renderToStaticMarkup(createElement(FoundingMemberCard))).toBe("");
  });

  it("renders no door at all when no invite is configured", () => {
    delete process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
    membershipState.value = { state: "member", number: 3 };
    const markup = renderToStaticMarkup(createElement(FoundingMemberCard));
    // The number still stands. Only the door is missing, and a missing door is
    // rendered as nothing rather than as a dead link.
    expect(markup).toContain("Founding member · No. 3");
    expect(markup).not.toContain(escaped(FOUNDERS_DISCORD_CTA));
    expect(markup).not.toContain("Discord");
    expect(renderToStaticMarkup(createElement(FoundersDiscordLink))).toBe("");
  });

  it("opens the invite in a new tab without handing it the opener", () => {
    membershipState.value = { state: "member", number: 3 };
    const markup = renderToStaticMarkup(createElement(FoundersDiscordLink));
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("noreferrer");
    expect(markup).toContain("noopener");
  });
});

// ── Tree-wide fence ──────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

describe("the invite lives in the environment, not in the tree", () => {
  it("is never written into a component, a page or a library", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        // Strip comments: the rule is about what ships to a reader, and the
        // hosts allow-list in lib/foundingMembers.ts is a check, not a link.
        const code = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (/https?:\/\/(www\.)?discord\.(gg|com)\//i.test(code)) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is documented in .env.example as a name and a format, never a value", () => {
    const env = readFileSync(join(ROOT, ".env.example"), "utf8");
    // The variable is documented, its format is stated, and the value is empty:
    // the real invite is a live door into a private room, so it belongs in the
    // deployment environment.
    expect(env).toMatch(/^NEXT_PUBLIC_DISCORD_INVITE_URL=$/m);
    expect(env).toContain("https://discord.gg/<invite-code>");
  });

  // A committed example or test fixture is a shipped artifact too: an invite
  // pasted into either is as reachable as one pasted into a component.
  it("is never a real invite in a committed example or harness config", () => {
    for (const file of [".env.example", "playwright.config.ts"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      const codes = [...source.matchAll(/https?:\/\/(?:www\.)?discord\.(?:gg|com)\/([^\s"'`<>]+)/gi)]
        .map((match) => match[1]);
      for (const code of codes) {
        // Only an obvious placeholder may appear: a bracketed token, or a code
        // that names itself as a test or example value.
        expect(code).toMatch(/^<.+>$|test|example|placeholder|e2e/i);
      }
    }
  });
});
