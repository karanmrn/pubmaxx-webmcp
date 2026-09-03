// The two reading surfaces for a linked social: the stranger's card on
// /u/[handle], and the owner's editor. The card's job is an outbound link that
// says whose account it is; the editor's job is to invite one and take it back.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ProfileSocialLinks from "@/components/profile/ProfileSocialLinks";
import SocialLinksEditor, {
  SocialConnectionActions,
} from "@/components/profile/SocialLinksEditor";
import {
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@/lib/socialConnections";
import { type SocialProviderCapabilities } from "@/lib/socialProviderCapabilities";

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => new Response("{}", { status: 401 }),
  authedActionFetch: async () => new Response("{}", { status: 401 }),
}));

function availability(
  overrides: Partial<Record<SocialProvider, Partial<SocialProviderCapabilities>>>,
): Record<SocialProvider, SocialProviderCapabilities> {
  return Object.fromEntries(
    SOCIAL_PROVIDERS.map((provider) => [
      provider,
      {
        manual_link: true,
        oauth_identity: false,
        read_selected_content: false,
        publish: false,
        ...overrides[provider],
      },
    ]),
  ) as Record<SocialProvider, SocialProviderCapabilities>;
}

describe("public social links", () => {
  it("renders nothing when a profile has linked nothing", () => {
    expect(renderToStaticMarkup(createElement(ProfileSocialLinks, { links: [] }))).toBe("");
  });

  it("links out safely and claims the accounts belong to the same person", () => {
    const html = renderToStaticMarkup(
      createElement(ProfileSocialLinks, {
        links: [
          {
            provider: "instagram",
            label: "Instagram",
            mark: "IG",
            username: "night.owl",
            profileUrl: "https://www.instagram.com/night.owl/",
          },
          {
            provider: "website",
            label: "Website",
            mark: "WW",
            username: "nightowl.co.uk",
            profileUrl: "https://nightowl.co.uk/",
          },
        ],
      }),
    );

    expect(html).toContain('href="https://www.instagram.com/night.owl/"');
    expect(html).toContain('href="https://nightowl.co.uk/"');
    expect(html).toContain('rel="me noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Instagram");
    expect(html).toContain("night.owl");
    expect(html).toContain("nightowl.co.uk");
  });
});

describe("social links editor", () => {
  it("invites a first link without pretending anything is there", () => {
    const html = renderToStaticMarkup(createElement(SocialLinksEditor));

    expect(html).toContain("Link your socials");
    expect(html).toContain("Add the accounts you want people to find you on.");
    expect(html).not.toContain("socialLinksList");
  });

  it("offers every provider a person may link", () => {
    const html = renderToStaticMarkup(createElement(SocialLinksEditor));

    for (const label of [
      "X",
      "Instagram",
      "TikTok",
      "YouTube",
      "Letterboxd",
      "Spotify",
      "Snapchat",
      "Strava",
      "LinkedIn",
      "Website",
    ]) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(html).toMatch(/<option value="instagram" disabled=""[^>]*>Instagram<\/option>/);
    expect(html).toContain('class="socialLinksAdd" disabled=""');
  });

  it("renders only OAuth providers declared available by the server", () => {
    const html = renderToStaticMarkup(
      createElement(SocialConnectionActions, {
        providers: availability({
          x: { oauth_identity: true },
          instagram: { oauth_identity: true },
        }),
        onConnect: vi.fn(),
      }),
    );

    expect(html).toContain("Connect X");
    expect(html).toContain("Connect Instagram");
    expect(html).not.toContain("Connect TikTok");
  });

  it("renders no dead OAuth controls when no provider is configured", () => {
    const html = renderToStaticMarkup(
      createElement(SocialConnectionActions, {
        providers: availability({}),
        onConnect: vi.fn(),
      }),
    );
    expect(html).toBe("");
  });

  it("edits public links beside the public fields, never the private ones", () => {
    // Linked socials are public content the owner typed in. They belong in the
    // public profile editor; email, date of birth and gender stay in Account
    // settings.
    const source = readFileSync(
      join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
      "utf8",
    );
    const surface = source.slice(
      source.indexOf('className="profileEditingSurface"'),
      source.indexOf("profileDropsSection"),
    );
    expect(surface).toContain("<SocialLinksEditor />");
    expect(surface).not.toContain("<PrivateIdentityEditor />");
    // One editor for one list: a second live copy on the same page would drift
    // from the first the moment either one wrote.
    expect(source.split("<SocialLinksEditor />").length - 1).toBe(1);
    expect(
      readFileSync(join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"), "utf8"),
    ).not.toContain("SocialLinksEditor");
  });
});
