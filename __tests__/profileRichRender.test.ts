// The two reading surfaces of a rich profile: the stranger's card and the
// owner's composer. The card prints only what its owner filled in, wears a
// cover when one was approved and the brass treatment when none was, and never
// invents a line. The composer asks for the same things in three groups, so
// eight inputs read as an identity rather than a settings page.

import { createElement, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => null }));

import PintPassport from "@/components/profile/PintPassport";
import ProfileEditor from "@/components/profile/ProfileEditor";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { buildPassport } from "@/lib/passport";
import { UNCOUNTED_STAT, type Profile, type ProfileStats } from "@/lib/profiles";

type ViewerState = "loading" | "resolved";
type HeaderProps = ComponentProps<typeof ProfileHeader> & { viewerState?: ViewerState };

const STATS: ProfileStats = {
  pintsLogged: 3,
  cheapestPintGbp: 4.8,
  crawlsPosted: 0,
  memoriesPosted: 0,
};

function header(profile: Partial<Profile>, viewerState: ViewerState = "resolved"): string {
  return renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile: { handle: "alice", displayName: "Alice Fennimore", ...profile },
      stats: STATS,
      viewerState,
    } as HeaderProps),
  );
}

function editor(initial: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    createElement(ProfileEditor, {
      handle: "alice",
      initial,
      onSaved: () => {},
      onProfileChanged: () => {},
      onClose: () => {},
    }),
  );
}

describe("public profile card", () => {
  it("uses neutral loading shapes while viewer identity is unresolved", () => {
    const markup = header({ handle: "you", displayName: "You" }, "loading");

    expect(markup).toContain("profileHeaderLoading");
    expect(markup).toContain("profileSkeleton");
    expect(markup).not.toContain(">You<");
    expect(markup).not.toContain("@you");
    expect(markup).not.toMatch(/<dd>0<\/dd>/);
  });

  it("keeps resolved viewer data visible", () => {
    const markup = header(
      { handle: "alice", displayName: "Alice Fennimore" },
      "resolved",
    );

    expect(markup).toContain(">Alice Fennimore<");
    expect(markup).toContain("@alice");
    expect(markup).toContain(">3<");
  });

  it("prints the card facts its owner filled in, with their own labels", () => {
    const markup = header({
      favouriteDrink: "Guinness",
      interests: "Quiz nights and back-room jazz",
      workplace: "Hackney Bridge Studios",
    });

    expect(markup).toContain("profileCardFacts");
    expect(markup).toContain("Drinks");
    expect(markup).toContain("Guinness");
    expect(markup).toContain("Into");
    expect(markup).toContain("Quiz nights and back-room jazz");
    expect(markup).toContain("Works at");
    expect(markup).toContain("Hackney Bridge Studios");
  });

  it("says nothing at all when a profile filled nothing in", () => {
    const markup = header({});
    expect(markup).not.toContain("profileCardFacts");
    expect(markup).not.toContain("Drinks");
    expect(markup).not.toContain("Works at");
  });

  it("omits one absent fact rather than printing an empty label", () => {
    const markup = header({ favouriteDrink: "Cider", workplace: "   " });
    expect(markup).toContain("Drinks");
    expect(markup).not.toContain("Works at");
  });

  it("wears an approved cover as the header backdrop", () => {
    const markup = header({ coverUrl: "/api/cover/profile-1/generation-1" });
    expect(markup).toContain("profileHeaderWithCover");
    expect(markup).toContain("profileCoverImage");
    expect(markup).toContain("/api/cover/profile-1/generation-1");
    // The falloff is what keeps the name legible over a photograph.
    expect(markup).toContain("profileCoverFalloff");
  });

  it("keeps the brass treatment when no cover was approved", () => {
    const markup = header({});
    expect(markup).toContain("profileCover");
    expect(markup).not.toContain("profileHeaderWithCover");
    expect(markup).not.toContain("profileCoverImage");
  });

  it("never prints a storage key or a moderation state", () => {
    const markup = header({
      coverUrl: "/api/cover/profile-1/generation-1",
      avatarUrl: "/api/avatar/profile-1/generation-1",
    });
    expect(markup).not.toContain("covers/");
    expect(markup).not.toContain("avatars/");
    expect(markup).not.toContain("staging.jpg");
    expect(markup).not.toContain("approved");
  });
});

describe("profile composer", () => {
  it("groups the questions instead of stacking eight inputs", () => {
    const markup = editor();
    expect(markup).toContain("Your look");
    expect(markup).toContain("You</legend>");
    expect(markup).toContain("Your night");
    expect(markup.match(/<fieldset/g) ?? []).toHaveLength(3);
  });

  it("asks for the cover, the photo, the name and every card field", () => {
    const markup = editor();
    for (const label of [
      "Cover photo",
      "Profile photo",
      "Display name",
      "Bio",
      "Home city",
      "Favourite drink",
      "What you&#x27;re into",
      "Where you work",
    ]) {
      expect(markup).toContain(label);
    }
  });

  it("offers drink suggestions from the drink taxonomy without closing the field", () => {
    const markup = editor();
    expect(markup).toContain('list="pe-drink-suggestions"');
    expect(markup).toContain("<datalist");
    expect(markup).toContain('value="Beer"');
    // `other` names no drink, so it is not a suggestion.
    expect(markup).not.toContain('value="Other"');
    // The field itself stays free text: no select, no closed set.
    expect(markup).not.toContain("<select");
  });

  it("pre-fills from the stored row and keeps Save and Cancel explicit", () => {
    const markup = editor({
      displayName: "Alice Fennimore",
      favouriteDrink: "Guinness",
      workplace: "Hackney Bridge Studios",
    });
    expect(markup).toContain('value="Alice Fennimore"');
    expect(markup).toContain('value="Guinness"');
    expect(markup).toContain('value="Hackney Bridge Studios"');
    expect(markup).toContain("Save profile");
    expect(markup).toContain("Cancel");
  });

  it("offers removal only for a slot that already holds an image", () => {
    expect(editor()).not.toContain("Remove photo");
    expect(editor({ avatarUrl: "/api/avatar/p/g" })).toContain("Remove photo");
  });

  // The FIRST PAINT never offers it, whatever the profile holds: a remove has
  // two lanes (the rotation's per-row DELETE, the single-slot one) and which it
  // belongs in is only known once the covers read answers. Offering it before
  // then armed the single-slot route for an owner whose rotation was still
  // loading, which cleared the mirror and left every backdrop rotating.
  // The control's arrival, and which lane it then takes, are mounted facts:
  // `__tests__/profileCoverEditorLanes.test.ts`.
  it("withholds Remove cover until the covers read answers", () => {
    expect(editor()).not.toContain("Remove cover");
    expect(editor({ coverUrl: "/api/cover/p/g" })).not.toContain("Remove cover");
  });

  // The backdrop is a rotation of up to five, so the composer owns a LIST
  // rather than one slot. There is exactly one cover control on the page: two
  // live copies of the same choice drift the moment either one writes.
  it("gives the covers one list control and no second single-cover slot", () => {
    const markup = editor({ coverUrl: "/api/cover/p/g" });
    expect(markup).toContain("Cover photos");
    expect(markup).toContain("Add cover");
    expect(markup).not.toContain("Choose cover");
  });
});

describe("shipped profile CSS", () => {
  const css = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");

  it("keeps the cover behind a falloff so the name stays legible", () => {
    expect(css).toContain(".profilePage .profileCover {");
    expect(css).toContain(".profilePage .profileCoverFalloff {");
    expect(css).toMatch(/profileCoverFalloff \{[^}]*linear-gradient/);
  });

  it("gives the face its own edge over the band, and hangs it over the edge", () => {
    // The band is painted on every profile now, photograph or brass wash, so
    // the ring is unconditional rather than a with-cover special case.
    expect(css).toMatch(
      /\.profilePage \.profileAvatar \{[^}]*border: 4px solid var\(--panel-raised\)/,
    );
    expect(css).toMatch(
      /\.profilePage \.profileIdentity \{[^}]*margin-top: calc\(-1 \* var\(--profile-avatar-overlap\)\)/,
    );
  });

  // What an owner framed in the cropper is what a reader sees. A band with a
  // fixed height over a fluid width shows a different rectangle at every
  // viewport, which is how a carefully framed photograph got cut mid-word.
  it("renders a cover at the cropper's own aspect ratio", () => {
    expect(css).toMatch(
      /\.profilePage \.profileHeaderWithCover \.profileCover \{[^}]*aspect-ratio: 3 \/ 1/,
    );
    // The brass wash has no photograph to crop, so it takes a shorter band
    // rather than four hundred pixels of gradient above the fold.
    expect(css).toMatch(/\.profilePage \.profileCover \{[^}]*height: clamp\(116px/);
  });

  // The rotation crossfades only for a reader who did not ask for less motion;
  // the component refuses to run its timer under the same condition.
  it("gates the crossfade on prefers-reduced-motion", () => {
    const gated = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(gated).toMatch(/\.profileCoverImage \{[^}]*transition: opacity/);
    expect(css.slice(0, css.indexOf("@media (prefers-reduced-motion"))).not.toMatch(
      /\.profileCoverImage \{[^}]*transition/,
    );
  });

  it("wraps a card fact rather than truncating what somebody wrote", () => {
    expect(css).toMatch(/profileCardFact dd \{[^}]*overflow-wrap: anywhere/);
    expect(css).not.toMatch(/profileCardFact dd \{[^}]*text-overflow: ellipsis/);
  });

  it("leaves press feedback to the one owner in globals.css", () => {
    // app/globals.css scales every button on :active behind the reduced-motion
    // gate. A second scale here would be a second owner of the same moment.
    expect(css).not.toMatch(/profileEditor[A-Za-z]*:active/);
  });
});

// A COUNT THE READ COULD NOT PRODUCE IS NOT A ZERO.
//
// /api/crawls?author= answers `count: null` when its one read fails, and the
// whole point of that tri-state is that it survives to the face somebody looks
// at. Both surfaces that print a crawl figure are checked here, because they
// take it through different props and used to flatten it independently: the
// header tile through `crawls`, the passport grid through buildPassport.
describe("an unmeasured count never renders as zero", () => {
  const passportMarkup = (counts: Parameters<typeof buildPassport>[1]): string =>
    renderToStaticMarkup(
      createElement(PintPassport, {
        handle: "alice",
        displayName: "Alice Fennimore",
        data: buildPassport([{ handle: "alice", venueId: "v1", priceGbp: 5 }], counts),
      }),
    );

  function statValues(markup: string): string[] {
    return [...markup.matchAll(/class="(?:passportStatValue|profileStatValue)"[^>]*>([^<]*)</g)].map(
      (match) => match[1],
    );
  }

  it("prints the header tile figure when the count is known", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfileHeader, {
        profile: { handle: "alice", displayName: "Alice Fennimore" },
        stats: STATS,
        crawls: 12,
      } as HeaderProps),
    );
    expect(markup).toContain("12");
    expect(markup).not.toContain(UNCOUNTED_STAT);
  });

  it("names the header tile uncounted rather than zero when the read failed", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfileHeader, {
        profile: { handle: "alice", displayName: "Alice Fennimore" },
        stats: STATS,
        crawls: null,
      } as HeaderProps),
    );
    // The accessible name carries it too, so the tile is not a bare figure to
    // a screen reader either.
    expect(markup).toContain(`Crawls: ${UNCOUNTED_STAT}.`);
    expect(markup).not.toContain("Crawls: 0.");
    expect(statValues(markup)).toContain(UNCOUNTED_STAT);
  });

  it("names the passport crawls and story posts uncounted when the read failed", () => {
    const markup = passportMarkup({ crawls: null, storyPosts: null });
    expect(statValues(markup).filter((value) => value === UNCOUNTED_STAT)).toHaveLength(2);
  });

  it("still prints a real zero for an author who has posted none", () => {
    const markup = passportMarkup({ crawls: 0, storyPosts: 0 });
    expect(markup).not.toContain(UNCOUNTED_STAT);
    expect(statValues(markup)).toContain("0");
  });

  // A blank-passport CTA claims the page is empty. An unmeasured count cannot
  // support that claim, so the copy is held back rather than telling somebody
  // with twelve crawls to start collecting.
  it("never calls a passport blank on the strength of a failed read", () => {
    expect(buildPassport([], { crawls: null, storyPosts: null }).isEmpty).toBe(false);
    expect(buildPassport([], { crawls: 0, storyPosts: 0 }).isEmpty).toBe(true);
    expect(buildPassport([]).isEmpty).toBe(true);
  });
});
