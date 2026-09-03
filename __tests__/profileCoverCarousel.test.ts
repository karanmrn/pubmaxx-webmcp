// The banner band a reader actually sees, and the editor a person actually
// edits in.
//
// TWO things are fenced here.
//
// 1. THE CAROUSEL STARTS STILL. A server render cannot ask a reader's motion
//    setting, so the first paint is cover #1 alone on every machine, and the
//    other four are not even fetched. Under `prefers-reduced-motion: reduce`
//    that is also the LAST paint: the component refuses to run its timer, so
//    "reduced motion" means no rotation rather than a slower one. There is no
//    DOM in this suite (vitest runs on node), so the timer half is fenced on
//    `coverCarouselRotates` - the ONE predicate the component consults - and on
//    the source that consults it.
//
// 2. AN UPLOAD DOES NOT END AN EDITING SESSION. Choosing a profile photo from
//    the editor threw the owner out to the read-only profile, because the
//    editor reported every image write through the same callback the Save
//    button used, and the page's handler closed the editor. They are two
//    callbacks now, and only one of them calls `setEditing(false)`.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => null }));

import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { coverCarouselRotates } from "@/lib/profileCovers";
import type { Profile, ProfileStats } from "@/lib/profiles";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const COVERS = [
  "/api/cover/p/one",
  "/api/cover/p/two",
  "/api/cover/p/three",
];

const STATS: ProfileStats = {
  pintsLogged: 3,
  cheapestPintGbp: 4.8,
  crawlsPosted: 0,
  memoriesPosted: 0,
};

function carousel(covers: readonly string[]): string {
  return renderToStaticMarkup(createElement(ProfileCoverCarousel, { covers }));
}

function header(profile: Partial<Profile>): string {
  return renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile: { handle: "alice", displayName: "Alice Fennimore", ...profile },
      stats: STATS,
    }),
  );
}

describe("the cover carousel", () => {
  it("paints one cover before it knows the reader's motion setting", () => {
    const markup = carousel(COVERS);
    expect(markup).toContain(COVERS[0]);
    expect(markup).not.toContain(COVERS[1]);
    expect(markup).not.toContain(COVERS[2]);
  });

  it("marks the painted cover active, so the stack has exactly one opaque frame", () => {
    const markup = carousel(COVERS);
    expect(markup.match(/profileCoverImageActive/g) ?? []).toHaveLength(1);
  });

  it("renders nothing at all when there is no backdrop", () => {
    expect(carousel([])).toBe("");
  });

  // The predicate the component consults, on its own: no rotation for one
  // cover, and none for a reader who asked for less motion.
  it("refuses to rotate under reduced motion, at any count", () => {
    for (const count of [2, 3, 4, 5]) {
      expect(coverCarouselRotates({ count, reducedMotion: true })).toBe(false);
      expect(coverCarouselRotates({ count, reducedMotion: false })).toBe(true);
    }
  });

  it("consults that one predicate rather than deciding motion a second way", () => {
    const source = read("components/profile/ProfileCoverCarousel.tsx");
    expect(source).toContain("coverCarouselRotates");
    expect(source).toContain("window.matchMedia?.(REDUCE)");
    // Starts still: a page that starts moving and then stops is worse than one
    // that starts still and then moves. The server snapshot is what says so.
    expect(source).toMatch(
      /function reducedMotionServerSnapshot\(\): boolean \{\s*return true;/,
    );
    // The timer is guarded by the predicate, not by the count alone.
    expect(source).toMatch(/if \(!rotates\) return;/);
    // Only what is in the rotation is rendered, so a reader who asked for less
    // motion never downloads the four photos they will not be shown.
    expect(source).toContain("rotates ? usable : usable.slice(0, 1)");
  });
});

describe("the header's backdrop", () => {
  it("wears the whole rotation when one travelled", () => {
    const markup = header({ coverUrl: COVERS[0], coverUrls: COVERS });
    expect(markup).toContain("profileHeaderWithCover");
    expect(markup).toContain(COVERS[0]);
  });

  // A surface that only knows the single cover asked a narrower question, and
  // gets the answer it can use rather than a blank band.
  it("falls back to the single cover, and keeps the brass band with neither", () => {
    expect(header({ coverUrl: COVERS[0] })).toContain(COVERS[0]);
    const bare = header({});
    expect(bare).toContain("profileCover");
    expect(bare).not.toContain("profileHeaderWithCover");
    expect(bare).not.toContain("profileCoverImage");
  });

  it("never prints a storage key or a moderation state", () => {
    const markup = header({ coverUrls: COVERS, avatarUrl: "/api/avatar/p/g" });
    expect(markup).not.toContain("covers/");
    expect(markup).not.toContain("staging.jpg");
    expect(markup).not.toContain("approved");
  });
});

describe("an upload keeps the editor open", () => {
  const editor = read("components/profile/ProfileEditor.tsx");
  const covers = read("components/profile/ProfileCoverPhotosEditor.tsx");
  const page = read("app/u/[handle]/ProfilePageClient.tsx");

  it("reports an image write through onProfileChanged, never onSaved", () => {
    // The avatar's upload and delete, and every cover write, take the callback
    // that repaints the card without ending the session.
    expect(editor).toContain("onProfileChanged(profile)");
    expect(covers).toContain("onProfileChanged(reply.profile)");
    // `onSaved` survives in exactly one place: the form's own submit.
    expect(editor.match(/onSaved\(profile\)/g) ?? []).toHaveLength(1);
    const submit = editor.slice(editor.indexOf("async function handleSubmit"));
    expect(submit).toContain("onSaved(profile)");
  });

  it("closes the editor only from the save handler", () => {
    expect(page).toContain("function handleProfileChanged(next: PublicProfile) {\n    setStored(next);\n  }");
    expect(page).toContain("setEditing(false);\n    setSavedNotice(true);");
    const changed = page.slice(
      page.indexOf("function handleProfileChanged"),
      page.indexOf("function handleSaved"),
    );
    expect(changed).not.toContain("setEditing(false)");
    expect(changed).not.toContain("router.");
  });

  it("wires both callbacks into the editor it mounts", () => {
    expect(page).toContain("onSaved={handleSaved}");
    expect(page).toContain("onProfileChanged={handleProfileChanged}");
  });
});
