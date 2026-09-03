import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  identityResolved: false,
  user: null as { id: string } | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

import {
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";
import SocialTagInbox from "@/app/social/SocialTagInbox";
import SocialOutbox from "@/app/social/SocialOutbox";
import CrewsPanel from "@/components/social/CrewsPanel";

const cardSources = [
  readFileSync("app/social/SocialTagInbox.tsx", "utf8"),
  readFileSync("app/social/SocialOutbox.tsx", "utf8"),
  readFileSync("components/social/CrewsPanel.tsx", "utf8"),
];

describe("Social viewer identity presentation", () => {
  it.each([
    ["unresolved", "Loading Social cards", "socialIdentitySkeletons"],
    ["signed-out", "Review your photo tags.", "socialIdentityInvite"],
  ] as const)("uses neutral %s state", (phase, message, marker) => {
    const html = renderToStaticMarkup(
      createElement(SocialViewerState, {
        phase,
        loadingLabel: "Loading Social cards",
        inviteMessage: "Review your photo tags.",
      }, createElement("p", null, "Authed data")),
    );

    expect(html).toContain(marker);
    expect(html).toContain(message);
    expect(html).not.toContain("Tags to review are unavailable right now.");
    expect(html).not.toContain("Posts are unavailable right now.");
    expect(html).not.toContain("Could not load your crews. That is us, not you.");
    expect(html).not.toContain("Retry");
  });

  it("renders data only after identity resolves to an authed viewer", () => {
    const html = renderToStaticMarkup(
      createElement(SocialViewerState, {
        phase: "resolved" satisfies SocialViewerPhase,
        loadingLabel: "Loading Social cards",
        inviteMessage: "Review your photo tags.",
      }, createElement("p", null, "Authed data")),
    );

    expect(html).toContain("Authed data");
    expect(html).not.toContain("socialIdentitySkeletons");
    expect(html).not.toContain("socialIdentityInvite");
  });

  it("gates every viewer-owned card on the shared identity phase", () => {
    for (const source of cardSources) {
      expect(source).toContain("SocialViewerState");
      expect(source).toContain("identityResolved");
      expect(source).toContain('user ? "resolved" : "signed-out"');
      expect(source).toContain('viewerPhase !== "resolved"');
    }
  });

  it("uses strict auth transport for photo tag reads and actions", () => {
    const source = cardSources[0] ?? "";
    expect(source).toContain("authedActionFetch");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps unresolved cards neutral and signed-out cards invitational", () => {
    const cards = [
      createElement(SocialTagInbox),
      createElement(SocialOutbox, {
        draftScope: null,
        submittedPost: null,
        onPostChanged: () => undefined,
      }),
      createElement(CrewsPanel, { compact: true }),
    ];

    const unresolved = cards.map((card) => renderToStaticMarkup(card)).join("");
    expect(unresolved.match(/socialIdentitySkeletons/g)).toHaveLength(3);
    expect(unresolved).not.toContain("Retry");

    authState.identityResolved = true;
    const signedOut = cards.map((card) => renderToStaticMarkup(card)).join("");
    expect(signedOut.match(/socialIdentityInvite/g)).toHaveLength(3);
    expect(signedOut.match(/href="\/login\?mode=signin&amp;from=%2Fsocial"/g)).toHaveLength(3);
    expect(signedOut).not.toContain("unavailable right now");
    expect(signedOut).not.toContain("Retry");
  });
});
