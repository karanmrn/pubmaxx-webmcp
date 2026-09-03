import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import {
  SocialAccessBoundary,
  SocialContextRail,
  SocialPostCard,
} from "@/app/social/SocialPageClient";
import type { SocialPostDTO } from "@/lib/socialPosts";

const protectedPost: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "friends",
  body: "A protected post body",
  area: "camden",
  venueId: "venue-a",
  venueProjected: true,
  hashtags: ["quietpint"],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  mutationVersion: 0,
  editedAt: null,
  createdAt: "2026-08-05T12:00:00.000Z",
  updatedAt: "2026-08-05T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: true,
  venueName: "The Test Arms",
};

const socialCss = readFileSync("app/social/social.css", "utf8");

describe("Social access boundary", () => {
  it("keeps signed-out preview to one boundary and one sign-in action", () => {
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "sign_in_required",
        friendsLaunchEnabled: true,
      }),
    );

    expect(html).toContain("Sign in to use Social.");
    expect(html).not.toContain("socialFeedEmpty");
    expect(html.match(/href="/g)).toHaveLength(1);
  });

  it("uses a compact boundary so preview does not leave a large empty panel", () => {
    const boundary =
      socialCss.match(
        /\.socialBoundary,\s*\.socialFeedError,\s*\.socialFeedEmpty\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(boundary).toMatch(/min-height:\s*200px/);
    expect(socialCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.socialBoundary\s*\{[^}]*min-height:\s*220px/);
  });

  it.each([
    [
      "preview",
      false,
      "Social preview is invite-only for now. It opens more widely soon.",
    ],
    ["sign_in_required", false, "Sign in to use Social preview."],
    [
      "age_verification_required",
      false,
      "Adult check needed for Social preview.",
    ],
    ["suspended", false, "Social preview access is suspended."],
    [
      "preview",
      true,
      "Social is invite-only for now. It opens more widely soon.",
    ],
    ["sign_in_required", true, "Sign in to use Social."],
    [
      "age_verification_required",
      true,
      "Adult check needed for Social.",
    ],
    ["suspended", true, "Social access is suspended."],
  ] as const)(
    "renders the honest %s boundary (%s launch) without protected metadata",
    (state, friendsLaunchEnabled, copy) => {
      const html = renderToStaticMarkup(
        createElement(SocialAccessBoundary, {
          state,
          friendsLaunchEnabled,
        }),
      );

      expect(html).toContain(copy);
      expect(html).not.toContain(protectedPost.body);
      expect(html).not.toContain(protectedPost.author.handle);
      expect(html).not.toContain(protectedPost.id);
      expect(html).not.toContain("/api/social/posts");
      if (state === "sign_in_required") {
        expect(html).toContain('href="/login?mode=signin&amp;from=%2Fsocial"');
      } else {
        expect(html).not.toContain("href=");
      }
    },
  );

  it("asks the age question as one line and one button", () => {
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "age_verification_required",
        adultPrompt: true,
        onAssertAdult: () => undefined,
        friendsLaunchEnabled: false,
      }),
    );

    expect(html).toContain("Social preview is for over-18s.");
    expect(html).toContain("I&#x27;m 18 or over");
    // One line, one button, in the empty-state idiom. Never a dialog.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("role=\"dialog\"");
    expect(html).not.toContain("Adult check needed for Social preview.");
    expect(html).not.toContain(protectedPost.body);
  });

  it("names Social when friends launch is on for the age question", () => {
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "age_verification_required",
        adultPrompt: true,
        onAssertAdult: () => undefined,
        friendsLaunchEnabled: true,
      }),
    );

    expect(html).toContain("Social is for over-18s.");
    expect(html).not.toContain("Social preview is for over-18s.");
  });

  it("keeps the plain refusal when the one tap would change nothing", () => {
    // A stored under-18 date of birth, or an assertion already recorded beside
    // some other reason: the server says so by leaving adultPrompt off.
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "age_verification_required",
        onAssertAdult: () => undefined,
        friendsLaunchEnabled: false,
      }),
    );

    expect(html).toContain("Adult check needed for Social preview.");
    expect(html).not.toContain("I&#x27;m 18 or over");
    expect(html).not.toContain("<button");
  });

  it("offers one explicit retry when access checks are unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "unavailable",
        onRetry: () => undefined,
        friendsLaunchEnabled: false,
      }),
    );

    expect(html).toContain("Social preview is unavailable right now.");
    expect(html).toContain("Retry");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe("verified Social post card", () => {
  it("ships CAS edit controls with conflict-safe draft recovery", () => {
    const source = readFileSync("app/social/SocialComposer.tsx", "utf8");
    expect(source).toContain("Edit post");
    expect(source).toContain("expectedMutationVersion");
    expect(source).toContain("removePhoto");
    expect(source).toContain("Load latest");
    expect(source).toContain("Post changed. Your draft is still here.");
    expect(source).toContain("BroadcastChannel");
    expect(source).toContain("useDismissOnEscape");
    expect(source).toContain("Selected Venue");
    expect(source).toContain("Remove venue");
  });

  it("renders the chronological DTO without legacy interaction controls", () => {
    const html = renderToStaticMarkup(
      createElement(SocialPostCard, { post: protectedPost }),
    );

    expect(html).toContain("@alice");
    expect(html).toContain(protectedPost.body);
    expect(html).toContain("Camden");
    expect(html).toContain("#quietpint");
    expect(html).toContain('href="/map?sel=venue-a"');
    expect(html).toContain("Open venue");
    expect(html).not.toContain("Open pub");
    expect(html).not.toContain("Cheers");
    expect(html).not.toContain("Comment");
    expect(html).not.toContain("For You");
    expect(html).not.toContain("Presence");
    expect(html).not.toContain("<button");
  });

  it("does not render exact Venue context from an invalid public DTO", () => {
    const html = renderToStaticMarkup(
      createElement(SocialPostCard, {
        post: { ...protectedPost, visibility: "public", venueProjected: false },
      }),
    );

    expect(html).toContain(protectedPost.body);
    expect(html).toContain("Camden");
    expect(html).not.toContain("Open venue");
    expect(html).not.toContain('href="/map?sel=venue-a"');
  });

  it("renders exact Venue context on a public DTO authorised for a mutual friend", () => {
    const html = renderToStaticMarkup(
      createElement(SocialPostCard, {
        post: { ...protectedPost, visibility: "public", venueProjected: true },
      }),
    );

    expect(html).toContain("Open venue");
    expect(html).toContain('href="/map?sel=venue-a"');
  });
});

describe("desktop Social rail", () => {
  it("preserves layout without policy helper copy", () => {
    const html = renderToStaticMarkup(
      createElement(SocialContextRail, { status: "loading" }),
    );

    expect(html).toContain('class="socialContextRail"');
    expect(html).toContain("Activity");
    expect(html).not.toContain("Social rules");
    expect(html).not.toContain("Newest first");
    expect(html).not.toContain("friend-gated");
  });

  it("keeps authorised Social activity inside the bounded rail", () => {
    const html = renderToStaticMarkup(
      createElement(SocialContextRail, {
        status: "ready",
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            kind: "comment",
            readAt: null,
            createdAt: "2026-08-05T19:00:00.000Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "tag_proposal",
            readAt: null,
            createdAt: "2026-08-05T19:01:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("New comment");
    expect(html).toContain("New photo tag");
    expect(html).not.toContain('href="/activity"');
    expect(html).not.toContain("Open Activity");
  });

  it.each(["unavailable", "ready"] as const)(
    "does not reserve a dead rail for %s without items",
    (status) => {
      const html = renderToStaticMarkup(
        createElement(SocialContextRail, { status, items: [] }),
      );

      expect(html).toBe("");
    },
  );
});
