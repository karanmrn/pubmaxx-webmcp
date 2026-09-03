// The public profile payload must never carry private account identity:
// email, date of birth, age, gender, sex, or full name live only behind the
// owner-authenticated /api/identity/onboarding read. This walks the real
// stores: onboard an account with every private field, then read its public
// profile as an anonymous caller.

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

import { PATCH, POST } from "@/app/api/identity/onboarding/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

function onboardingRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/identity/onboarding", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetPintDrops();
});

describe("public profile privacy", () => {
  it("excludes every private identity field from the public payload", async () => {
    authState.userId = "user-1";
    const onboarded = await POST(
      onboardingRequest("POST", {
        handle: "night_person",
        dateOfBirth: "1990-01-01",
        fullName: "Private Name",
        sex: "female",
      }),
    );
    expect(onboarded.status).toBe(201);
    const saved = await PATCH(
      onboardingRequest("PATCH", {
        gender: "self_described",
        genderSelfDescribed: "genderfluid",
      }),
    );
    expect(saved.status).toBe(200);

    authState.userId = null;
    const response = await getProfile(
      new Request("http://localhost/api/profiles/night_person"),
      { params: Promise.resolve({ handle: "night_person" }) },
    );
    expect(response.status).toBe(200);
    const raw = await response.text();

    for (const leak of [
      "dateOfBirth",
      "date_of_birth",
      "1990-01-01",
      "gender",
      '"sex"',
      "genderfluid",
      "Private Name",
      "fullName",
      "email",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });
});
