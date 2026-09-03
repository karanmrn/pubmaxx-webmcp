// The founders wall: /founders and the read behind it.
//
// The wall is public, so what it publishes is the question. It carries the
// number, the handle, the chosen display name and an approved avatar, which is
// exactly the directory's projection plus the number. Nothing about ownership,
// nothing private, and nobody who has left.

import { renderToStaticMarkup } from "react-dom/server";
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

// The wall page mounts the site nav, which needs the App Router context this
// server-render harness has no way to provide. The nav is not what is under
// test here; the list is.
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));

const storeFailure = vi.hoisted(() => ({ throwOnList: false }));
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...actual,
    profileStore: () => {
      const real = actual.profileStore();
      return {
        ...real,
        listFoundingMembers: async () => {
          if (storeFailure.throwOnList) throw new Error("store down");
          return real.listFoundingMembers();
        },
      };
    },
  };
});

import { GET as wallRoute } from "@/app/api/founding-members/route";
import FoundersPage from "@/app/founders/page";
import { PATCH, POST } from "@/app/api/identity/onboarding/route";
import { FOUNDERS_WALL_EMPTY, FOUNDERS_WALL_UNAVAILABLE } from "@/lib/foundingMembers";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles, __tombstoneMemoryProfile } from "@/lib/profileStore";

function onboard(userId: string, handle: string): Promise<Response> {
  authState.userId = userId;
  return POST(
    new Request("http://localhost/api/identity/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, dateOfBirth: "1990-01-01", fullName: "Private Name" }),
    }),
  );
}

/** React escapes the apostrophe in a text node, so the markup carries an entity. */
function escaped(text: string): string {
  return text.replace(/'/g, "&#x27;");
}

async function wall(): Promise<Record<string, unknown>> {
  const response = await wallRoute(new Request("http://localhost/api/founding-members"));
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  authState.userId = null;
  storeFailure.throwOnList = false;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetPintDrops();
});

describe("GET /api/founding-members", () => {
  it("lists the founders in number order with the public projection only", async () => {
    await onboard("user-1", "early_bird");
    await onboard("user-2", "night_owl");
    authState.userId = null;

    const body = await wall();
    expect(body.cap).toBe(100);
    expect(body.members).toEqual([
      { number: 1, handle: "early_bird" },
      { number: 2, handle: "night_owl" },
    ]);
  });

  it("never publishes ownership, tombstones or private identity", async () => {
    await onboard("user-1", "early_bird");
    authState.userId = "user-1";
    await PATCH(
      new Request("http://localhost/api/identity/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gender: "self_described", genderSelfDescribed: "genderfluid" }),
      }),
    );
    authState.userId = null;

    const raw = await (
      await wallRoute(new Request("http://localhost/api/founding-members"))
    ).text();
    for (const leak of [
      "userId",
      "user_id",
      "user-1",
      "tombston",
      "dateOfBirth",
      "1990-01-01",
      "Private Name",
      "gender",
      "genderfluid",
      "email",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("drops a founder who has left, and never renumbers the rest", async () => {
    await onboard("user-1", "first_in");
    await onboard("user-2", "second_in");
    authState.userId = null;
    __tombstoneMemoryProfile("first_in");

    const body = await wall();
    expect(body.members).toEqual([{ number: 2, handle: "second_in" }]);
  });

  it("answers 503 rather than an empty wall when the read fails", async () => {
    storeFailure.throwOnList = true;
    const response = await wallRoute(new Request("http://localhost/api/founding-members"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.members).toBeUndefined();
    expect(String(body.error)).not.toMatch(/store down|listFoundingMembers|supabase/i);
  });
});

describe("/founders", () => {
  it("prints every founder as a numbered row linking to their profile", async () => {
    await onboard("user-1", "early_bird");
    await onboard("user-2", "night_owl");
    authState.userId = null;

    const markup = renderToStaticMarkup(await FoundersPage());
    expect(markup).toContain("The first hundred");
    expect(markup).toContain("no perks");
    expect(markup).toContain("@early_bird");
    expect(markup).toContain("@night_owl");
    expect(markup).toContain('href="/u/early_bird"');
    expect(markup).toContain("2 of 100 taken.");
    // The list is ordered, so a reader with no styles still reads it in order.
    expect(markup).toContain("<ol");
    expect(markup.indexOf("early_bird")).toBeLessThan(markup.indexOf("night_owl"));
  });

  it("offers no way in, and no reason to hurry", async () => {
    await onboard("user-1", "early_bird");
    authState.userId = null;
    const markup = renderToStaticMarkup(await FoundersPage());
    expect(markup).not.toMatch(/claim yours|get your number|only \d+ left|hurry/i);
    expect(markup).not.toContain("Discord");
  });

  it("says nobody has claimed yet rather than nothing at all", async () => {
    const markup = renderToStaticMarkup(await FoundersPage());
    expect(markup).toContain(escaped(FOUNDERS_WALL_EMPTY));
  });

  it("says it could not check rather than calling the wall empty", async () => {
    storeFailure.throwOnList = true;
    const markup = renderToStaticMarkup(await FoundersPage());
    expect(markup).toContain(escaped(FOUNDERS_WALL_UNAVAILABLE));
    expect(markup).not.toContain(escaped(FOUNDERS_WALL_EMPTY));
  });
});
