import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression lock for the Lane M3 taste review P1 fixes. Text assertions over
// the shipped CSS + copy (the same house pattern as landingChromeCss.test.ts),
// so a silent revert of any fix fails CI rather than a browser QA pass we can't
// run headless.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

const palCss = read("app/pal/pal.css");
const profileCss = read("app/u/[handle]/profile.css");
const authCss = read("app/auth/auth.css");
const momentCss = read("components/moment/moment.css");
const messages = read("app/messages/MessagesInboxClient.tsx");

describe("Lane M3 taste P1 fixes", () => {
  it("#1 /pal CTA clears the tab bar via the shared --tabbar-h token", () => {
    expect(palCss).toMatch(
      /\.palExperience\s*{\s*padding:[^;]*var\(--tabbar-h[^;]*env\(safe-area-inset-bottom/,
    );
    // The old magic-number clearance is gone.
    expect(palCss).not.toMatch(/calc\(7\.25rem \+ env\(safe-area-inset-bottom/);
  });

  it("#1 /pal speech card sits on a solid house surface, not the accent wash", () => {
    const speech = ruleBody(palCss, ".palSpeech");
    expect(speech).toMatch(/background:\s*var\(--panel-raised\)\s*;/);
    expect(speech).not.toMatch(/panel-raised\) 84%, transparent/);
    // Border already rides the hairline (--pal-line == --line == --hairline).
    expect(speech).toMatch(/border:\s*1px solid var\(--pal-line\)/);
  });

  it("#2 /u/you PXX avatar drops navy for ink/coral house tokens", () => {
    const avatar = ruleBody(profileCss, ".profilePage .youIdentityAvatar");
    expect(avatar).not.toMatch(/var\(--river\)/);
    expect(avatar).toMatch(/var\(--ink-deep\)/);
    expect(avatar).toMatch(/var\(--brass\)/);
  });

  it("#2 /u/you keeps Claim primary and steps Pub Pal back to quiet secondary", () => {
    expect(profileCss).toMatch(
      /\.youIdentityActions a:first-child\s*{[^}]*background:\s*var\(--brass\)/,
    );
    const secondary = ruleBody(profileCss, ".profilePage .youIdentityActions a:last-child");
    expect(secondary).toMatch(/background:\s*transparent/);
    expect(secondary).toMatch(/border-color:\s*transparent/);
  });

  it("#3 sign-in wall primary uses accent fill + on-photo text", () => {
    const btn = ruleBody(authCss, ".authSignIn.authMagicLinkButton");
    expect(btn).toMatch(/background:\s*var\(--brass-accessible\)/);
    expect(btn).toMatch(/color:\s*var\(--color-on-photo\)/);
    expect(btn).toMatch(/min-height:\s*44px/);
  });

  it("#5 /moment photo drop uses a solid hairline, not a dashed placeholder", () => {
    const picker = ruleBody(momentCss, ".momentMediaPicker");
    expect(picker).toMatch(/border:\s*1px solid var\(--hairline\)/);
    expect(picker).not.toMatch(/border:\s*1px dashed/);
  });

  it("#6 messages courtesy note reads as two plain sentences, no splice", () => {
    expect(messages).toContain("Messages need a signed-in account. Keep it low-key, and report anything off.");
    // No semicolon splice, no Latinate "require", no em dash.
    expect(messages).not.toContain("low-stakes; report");
    expect(messages).not.toContain("Messages require a signed-in account");
    expect(messages).not.toMatch(/messagesCourtesyNote[\s\S]{0,120}—/);
  });
});
