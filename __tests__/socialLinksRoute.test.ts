// Add a link, read it back on the public card, take it away. This walks the
// real routes and the real stores: nothing here asserts against a fixture the
// application does not itself produce.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { POST as onboard } from "@/app/api/identity/onboarding/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import { GET as listConnections } from "@/app/api/social-connections/route";
import {
  DELETE as unlink,
  POST as link,
} from "@/app/api/social-connections/[provider]/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import { __resetMemorySocialConnections } from "@/lib/socialConnectionStore";
import type { PublicSocialLink } from "@/lib/socialConnections";

function linkRequest(provider: string, value: string): [Request, { params: Promise<{ provider: string }> }] {
  return [
    new Request(`http://localhost/api/social-connections/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual", value }),
    }),
    { params: Promise.resolve({ provider }) },
  ];
}

async function readCard(handle: string): Promise<{
  socialLinks: PublicSocialLink[];
  raw: string;
}> {
  const response = await getProfile(
    new Request(`http://localhost/api/profiles/${handle}`),
    { params: Promise.resolve({ handle }) },
  );
  const raw = await response.text();
  return { socialLinks: (JSON.parse(raw) as { socialLinks: PublicSocialLink[] }).socialLinks, raw };
}

beforeEach(async () => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  authState.userId = "user-1";
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemorySocialConnections();
  __resetPintDrops();
  const onboarded = await onboard(
    new Request("http://localhost/api/identity/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "night_person", dateOfBirth: "1990-01-01" }),
    }),
  );
  expect(onboarded.status).toBe(201);
});

describe("linking a social", () => {
  it("does not report Social counts or links during rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const card = await readCard("night_person");

    expect(card.socialLinks).toEqual([]);
    expect(JSON.parse(card.raw)).toMatchObject({
      counts: null,
      socialLinks: [],
    });
  });

  it("adds, publishes on the card, and removes again", async () => {
    expect((await readCard("night_person")).socialLinks).toEqual([]);

    const added = await link(...linkRequest("letterboxd", "nightowl"));
    expect(added.status).toBe(201);

    const card = await readCard("night_person");
    expect(card.socialLinks).toEqual([
      {
        provider: "letterboxd",
        label: "Letterboxd",
        mark: "LB",
        username: "nightowl",
        profileUrl: "https://letterboxd.com/nightowl/",
      },
    ]);

    const removed = await unlink(
      new Request("http://localhost/api/social-connections/letterboxd", { method: "DELETE" }),
      { params: Promise.resolve({ provider: "letterboxd" }) },
    );
    expect(removed.status).toBe(204);
    expect((await readCard("night_person")).socialLinks).toEqual([]);
  });

  it("replaces the link for a provider rather than stacking a second one", async () => {
    expect((await link(...linkRequest("x", "@first_handle"))).status).toBe(201);
    expect((await link(...linkRequest("x", "@second_handle"))).status).toBe(201);

    const card = await readCard("night_person");
    expect(card.socialLinks).toHaveLength(1);
    expect(card.socialLinks[0].profileUrl).toBe("https://x.com/second_handle");
  });

  it("accepts every provider a person may link", async () => {
    const values: Array<[string, string]> = [
      ["x", "@nightowl"],
      ["instagram", "@night.owl"],
      ["tiktok", "@nightowl"],
      ["youtube", "@nightowl"],
      ["letterboxd", "nightowl"],
      ["spotify", "https://open.spotify.com/user/nightowl"],
      ["snapchat", "night.owl"],
      ["strava", "https://www.strava.com/athletes/12345678"],
      ["linkedin", "https://www.linkedin.com/in/night-owl"],
      ["website", "https://nightowl.co.uk"],
    ];
    for (const [provider, value] of values) {
      const response = await link(...linkRequest(provider, value));
      expect([provider, response.status]).toEqual([provider, 201]);
    }

    const card = await readCard("night_person");
    expect(card.socialLinks.map((entry) => entry.provider)).toEqual(values.map(([p]) => p));
  });

  it("refuses a link the platform could not hold, and stores nothing", async () => {
    const rejected = await link(...linkRequest("x", "https://www.instagram.com/night.owl/"));
    expect(rejected.status).toBe(400);
    expect((await readCard("night_person")).socialLinks).toEqual([]);
  });

  it("refuses a service outside the closed set", async () => {
    const response = await link(...linkRequest("myspace", "nightowl"));
    expect(response.status).toBe(404);
  });

  it("needs a signed-in owner", async () => {
    authState.userId = null;
    expect((await link(...linkRequest("letterboxd", "nightowl"))).status).toBe(401);
    expect(
      (
        await listConnections(new Request("http://localhost/api/social-connections"))
      ).status,
    ).toBe(401);
  });

  it("keeps the public card free of private identity, links or not", async () => {
    await link(...linkRequest("instagram", "@night.owl"));
    authState.userId = null;

    const { raw } = await readCard("night_person");
    for (const leak of [
      "dateOfBirth",
      "1990-01-01",
      "email",
      "ownerId",
      "accessTokenCiphertext",
      "scopes",
      "accountKind",
    ]) {
      expect(raw).not.toContain(leak);
    }
    expect(raw).toContain("https://www.instagram.com/night.owl/");
  });
});
