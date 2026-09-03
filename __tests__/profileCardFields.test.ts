// A rich profile is a set of PUBLIC BY CHOICE fields: the drink somebody
// orders, what they are into, and where they work. They save through the same
// PATCH path as the name and bio, come back on the public read, cap at the
// server, and clear when the owner empties them. What they must NEVER do is
// widen the private set, so this also re-reads the payload for the private
// fields __tests__/profilesRoutePrivacy.test.ts guards.

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

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET, PATCH } from "@/app/api/profiles/[handle]/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import type { PublicProfile } from "@/lib/profiles";
import {
  __resetMemoryProfiles,
  MAX_FAVOURITE_DRINK,
  MAX_INTERESTS,
  MAX_WORKPLACE,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";

const params = { params: Promise.resolve({ handle: "alice" }) };

async function patch(body: Record<string, unknown>): Promise<Response> {
  return PATCH(
    new Request("http://localhost/api/profiles/alice", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function readPublic(): Promise<PublicProfile | null> {
  const response = await GET(new Request("http://localhost/api/profiles/alice"), params);
  const body = (await response.json()) as { profile?: PublicProfile | null };
  return body.profile ?? null;
}

beforeEach(async () => {
  authState.userId = "user-alice";
  __resetMemoryProfiles();
  __resetPintDrops();
  await memoryProfileStore.createOwned("alice", "user-alice");
});

describe("rich profile card fields", () => {
  it("saves and round-trips the name and every card field", async () => {
    const saved = await patch({
      displayName: "Alice Fennimore",
      bio: "Two pints and a walk home along the canal.",
      homeCity: "London",
      favouriteDrink: "Guinness",
      interests: "Quiz nights, back-room jazz, anywhere with a real fire",
      workplace: "Hackney Bridge Studios",
    });
    expect(saved.status).toBe(200);

    const stored = await profileStore().getByHandle("alice");
    expect(stored).toMatchObject({
      displayName: "Alice Fennimore",
      favouriteDrink: "Guinness",
      interests: "Quiz nights, back-room jazz, anywhere with a real fire",
      workplace: "Hackney Bridge Studios",
    });

    authState.userId = null;
    expect(await readPublic()).toMatchObject({
      displayName: "Alice Fennimore",
      favouriteDrink: "Guinness",
      interests: "Quiz nights, back-room jazz, anywhere with a real fire",
      workplace: "Hackney Bridge Studios",
    });
  });

  it("leaves a field untouched when the edit does not mention it", async () => {
    await patch({ favouriteDrink: "Cider", workplace: "The Depot" });
    await patch({ displayName: "Alice" });

    expect(await profileStore().getByHandle("alice")).toMatchObject({
      displayName: "Alice",
      favouriteDrink: "Cider",
      workplace: "The Depot",
    });
  });

  it("clears a field when the owner empties it", async () => {
    await patch({ favouriteDrink: "Cider", interests: "Darts", workplace: "The Depot" });
    await patch({ favouriteDrink: "", interests: "   ", workplace: "" });

    const stored = await profileStore().getByHandle("alice");
    expect(stored?.favouriteDrink).toBeUndefined();
    expect(stored?.interests).toBeUndefined();
    expect(stored?.workplace).toBeUndefined();

    // An absent field is absent from the public payload, not an empty string.
    authState.userId = null;
    const publicProfile = await readPublic();
    expect(publicProfile).not.toHaveProperty("favouriteDrink");
    expect(publicProfile).not.toHaveProperty("interests");
    expect(publicProfile).not.toHaveProperty("workplace");
  });

  it("caps each field at the server, whatever the client sent", async () => {
    await patch({
      favouriteDrink: "d".repeat(MAX_FAVOURITE_DRINK + 40),
      interests: "i".repeat(MAX_INTERESTS + 200),
      workplace: "w".repeat(MAX_WORKPLACE + 40),
    });

    const stored = await profileStore().getByHandle("alice");
    expect(stored?.favouriteDrink).toHaveLength(MAX_FAVOURITE_DRINK);
    expect(stored?.interests).toHaveLength(MAX_INTERESTS);
    expect(stored?.workplace).toHaveLength(MAX_WORKPLACE);
  });

  it("strips inline markup from every card field", async () => {
    await patch({
      favouriteDrink: "<script>alert(1)</script>Stout",
      interests: "Darts <img src=x onerror=1>",
      workplace: "<b>The Depot</b>",
    });

    const stored = await profileStore().getByHandle("alice");
    for (const value of [stored?.favouriteDrink, stored?.interests, stored?.workplace]) {
      expect(value).not.toContain("<");
      expect(value).not.toContain(">");
    }
    expect(stored?.workplace).toBe("bThe Depot/b");
  });

  it("keeps the private set out of the public payload while the card fields are public", async () => {
    await patch({
      favouriteDrink: "Guinness",
      interests: "Quiz nights",
      workplace: "Hackney Bridge Studios",
    });

    authState.userId = null;
    const raw = await (
      await GET(new Request("http://localhost/api/profiles/alice"), params)
    ).text();

    expect(raw).toContain("favouriteDrink");
    expect(raw).toContain("workplace");
    for (const leak of ["dateOfBirth", "date_of_birth", "gender", "fullName", "email", "userId"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("refuses an avatar URL on the field path, so images stay on the scanned lane", async () => {
    const response = await patch({ avatarUrl: "https://example.com/face.jpg" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
