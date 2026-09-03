import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import {
  DeviceNightProfileReadout,
  NightProfileControls,
  ReferralInviteCard,
} from "@/components/profile/PubmaxxAccountHub";

describe("PubmaxxAccountHub provider gating", () => {
  it("loads optional referral status without blocking account data", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(source).toContain("Promise.allSettled([");
    expect(source).not.toContain("void Promise.all([");
  });

  it("renders editable Night Profile controls with the privacy boundary", () => {
    const html = renderToStaticMarkup(createElement(NightProfileControls, {
      profile: DEFAULT_NIGHT_PROFILE_INPUT,
      saveLabel: "Saved on this device",
      onChange: vi.fn(),
    }));

    expect(html).toContain("Night Profile");
    expect(html).toContain("Your patch");
    expect(html).toContain("Max per person");
    expect(html).toContain("Voice");
    expect(html).toContain("Briefings");
    expect(html).toContain("Precise location and voice transcripts are never saved here.");
    expect(html).toContain("Saved on this device");
  });

  it("renders a read-only device Night Profile summary without form fields when signed out", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(source).toContain("DeviceNightProfileReadout");
    expect(source).toContain(
      "{deviceNightProfile ? <DeviceNightProfileReadout profile={deviceNightProfile} /> : null}",
    );
    expect(source).not.toContain(
      "saveLabel=\"Saved on this device\" onChange={editDeviceNightProfile}",
    );

    const html = renderToStaticMarkup(createElement(DeviceNightProfileReadout, {
      profile: DEFAULT_NIGHT_PROFILE_INPUT,
    }));
    expect(html).toContain("Saved on this device");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
  });

  it("offers one quiet invite action and states the contribution gate truthfully", () => {
    const html = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: {
        attributedCount: 2,
        qualifiedCount: 1,
        earned: [],
        mark: "Brought a mate in",
        nextMilestone: 3,
      },
      busy: false,
      link: null,
      notice: "",
      shareSupported: false,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));

    expect(html).toContain("Invite a mate");
    expect(html).toContain("first accepted contribution");
    expect(html).toContain("1 qualified referral");
    expect(html).toContain("Next milestone: 3");
    // A milestone is a mark of honour. The card prints it and says plainly
    // that nothing is behind it, so nobody reads the count as a key.
    expect(html).toContain("Brought a mate in");
    expect(html).toContain("Nothing here is gated behind it.");
    expect(html).not.toMatch(/unlock/i);
    expect(html).not.toMatch(/reward|perk|bounty|entitle/i);
    expect(html).not.toContain("inviter");
    expect(html).not.toContain("invitee");
  });

  it("prints no mark at all for somebody who has not reached a milestone", () => {
    const html = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: {
        attributedCount: 2,
        qualifiedCount: 0,
        earned: [],
        mark: null,
        nextMilestone: 1,
      },
      busy: false,
      link: null,
      notice: "",
      shareSupported: false,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));

    expect(html).not.toContain("accountHubReferralMark");
    expect(html).not.toContain("Brought");
  });

  it("shows a selectable link only after a deliberate invite action", () => {
    const withoutLink = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: null,
      notice: "",
      shareSupported: false,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));
    const withLink = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: "https://pubmaxxing.com/r/opaque",
      notice: "Your invite link is ready. Copy it or share it.",
      shareSupported: true,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));

    expect(withoutLink).not.toContain("https://pubmaxxing.com/r/opaque");
    expect(withoutLink).not.toContain("Copy link");
    expect(withLink).toContain("https://pubmaxxing.com/r/opaque");
    expect(withLink).toContain('readOnly=""');
    expect(withLink).toContain("Copy link");
    expect(withLink).toContain("Share…");
    expect(withLink).toContain("Your invite link is ready. Copy it or share it.");
  });

  it("hides the share button where the browser cannot share", () => {
    const html = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: "https://pubmaxxing.com/r/opaque",
      notice: "",
      shareSupported: false,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));
    expect(html).toContain("Copy link");
    expect(html).not.toContain("Share…");
  });

  it("reports an invite failure inside the card, never only at the page foot", () => {
    const html = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: null,
      notice: "Your invite link could not be made. Try again.",
      shareSupported: false,
      onInvite: vi.fn(),
      onCopy: vi.fn(),
      onShare: vi.fn(),
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Your invite link could not be made. Try again.");
  });

  it("never calls navigator.share after an await in the fetch flow", () => {
    // iOS drops the tap's user activation across an await, so a share() call
    // sequenced after the invite-link fetch silently fails. Sharing must live
    // in its own tap handler (shareInviteLink), not inside inviteMate.
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    const inviteMate = source.slice(
      source.indexOf("async function inviteMate"),
      source.indexOf("async function copyInviteLink"),
    );
    expect(inviteMate).toContain("authedActionFetch(\"/api/referrals/invite-link\"");
    expect(inviteMate).not.toContain("navigator.share");
  });

  it("keeps every referral RPC able to reach pgcrypto's digest()", () => {
    // Hosted Supabase installs pgcrypto in the `extensions` schema. Migration
    // 0060 pinned the referral functions to `search_path = public`, which made
    // every digest() call fail at runtime and turned "Invite a mate" into a
    // 503. Migration 0086 widens the search path; this pins that repair for
    // each digest-using function.
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260808150000_0086_referral_functions_extensions_search_path.sql",
      ),
      "utf8",
    );
    for (const fn of [
      "get_or_create_referral_invite_code",
      "record_referral_edge",
      "claim_referral_code",
      "qualify_referral_from_contribution",
      "read_private_referral_status",
      "erase_referral_account",
    ]) {
      expect(migration).toContain(`alter function public.${fn}`);
    }
    expect(migration).toContain("search_path = public, extensions, pg_temp");
  });

  it("never renders a dead error card for a failed Night Profile read", () => {
    // Defect 2: right after sign-in the first authed read can race session
    // establishment and 401. The hub retries once, then shows a visible
    // Try again affordance - never a permanent message with no way out.
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(source).not.toContain(
      'setMessage("Your account Night Profile could not be loaded.")',
    );
    expect(source).toContain("nightProfileAutoRetried.current = true");
    expect(source).toContain("setAccountLoadNonce");
    expect(source).toContain("Try again");
    // A failed read never counts as loaded: loaded gates the merge prompt and
    // the account save, which need the real account row.
    expect(source).toContain("if (nightProfile?.ok) setNightProfileLoaded(true);");
  });

  it("collapses the analytics choice card once a decision is made", () => {
    // Defect 6: after Allow or No thanks the two-button card must go. The
    // decided state is one status line with a small affordance to reverse it.
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(source).toContain("analyticsConsent === null ? (");
    expect(source).toContain('"Usage analytics on."');
    expect(source).toContain('"Usage analytics off."');
    expect(source).toContain('"Withdraw"');
    expect(source).toContain('className="accountHubConsentStatus" role="status"');
    // The old permanent confirmation sentences are gone with the card.
    expect(source).not.toContain("Usage analytics enabled.");
    expect(source).not.toContain("persistent browser analytics ID was removed");
  });
});
