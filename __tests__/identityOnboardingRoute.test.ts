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
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { GET, PATCH, POST } from "@/app/api/identity/onboarding/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  memoryProfileStore,
} from "@/lib/profileStore";
import { accountIsAdult } from "@/lib/socialLaunch";

const NOW = "2026-08-10T20:00:00.000Z";

function request(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/identity/onboarding", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetPintDrops();
});

describe("/api/identity/onboarding", () => {
  it("requires a verified account", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request("POST", { handle: "night_owl" }))).status).toBe(401);
  });

  it("reports incomplete state without inventing an email-derived handle", async () => {
    authState.userId = "user-1";
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete: false });
  });

  it("requires date of birth before claiming a handle", async () => {
    authState.userId = "user-1";
    const missing = await POST(request("POST", { handle: "night_owl" }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      code: "invalid",
      error: "Enter a valid date of birth.",
    });
    expect(await memoryProfileStore.getByHandle("night_owl")).toBeNull();

    const response = await POST(
      request("POST", {
        handle: "night_owl",
        dateOfBirth: "2015-02-03",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "night_owl",
      // The first claim in a fresh store lands inside the first hundred, so the
      // claim underneath grants a founding number and it rides out here.
      foundingMemberNumber: 1,
      dateOfBirth: "2015-02-03",
    });
  });

  it("distinguishes reserved handles from taken handles", async () => {
    authState.userId = "user-1";
    let response = await POST(
      request("POST", { handle: "karan", dateOfBirth: "1990-01-01" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "reserved",
      error: "That handle is not available.",
    });

    await memoryProfileStore.createOwned("night_owl", "user-other");
    response = await POST(
      request("POST", {
        handle: "night_owl",
        dateOfBirth: "1990-01-01",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "taken",
      error: "That handle is already taken.",
    });
  });

  it("limits the canonical handle claim mutation to 20 attempts", async () => {
    authState.userId = "user-1";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await POST(
        new Request("http://localhost/api/identity/onboarding", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.4",
          },
          body: "{",
        }),
      );
      expect(response.status).toBe(400);
    }

    const response = await POST(
      new Request("http://localhost/api/identity/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.4",
        },
        body: "{",
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Too many handle attempts. Try again shortly.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("keeps a legacy unlinked handle frozen", async () => {
    authState.userId = "user-1";
    const legacy = __seedMemoryLegacyProfile("old_timer");

    const response = await POST(
      request("POST", {
        handle: "old_timer",
        dateOfBirth: "1991-04-12",
        fullName: "Nina Example",
        sex: "female",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "taken",
      error: "That handle is already taken.",
      retryable: false,
    });
    expect(await memoryProfileStore.getByUserId("user-1")).toBeNull();
    expect((await memoryProfileStore.getByHandle("old_timer"))?.id).toBe(legacy.id);
  });

  it("lets the account owner edit and clear private optional details", async () => {
    authState.userId = "user-1";
    await POST(
      request("POST", {
        handle: "night_person",
        dateOfBirth: "1990-01-01",
        fullName: "Old Name",
        sex: "female",
      }),
    );

    const response = await PATCH(
      request("PATCH", {
        fullName: "New Name",
        sex: "",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "night_person",
      fullName: "New Name",
      dateOfBirth: "1990-01-01",
    });
  });

  it("round-trips a saved name back through GET", async () => {
    // Defect 3: the founder must see the name land and read back through the
    // app's own read path (private_account_identities.full_name).
    authState.userId = "user-1";
    await POST(
      request("POST", { handle: "night_person", dateOfBirth: "1990-01-01" }),
    );
    const saved = await PATCH(request("PATCH", { fullName: "Karan Founder" }));
    expect(saved.status).toBe(200);

    const readBack = await GET(request());
    expect(readBack.status).toBe(200);
    expect(await readBack.json()).toMatchObject({ fullName: "Karan Founder" });
  });

  it("lets the account owner set gender and correct their date of birth", async () => {
    authState.userId = "user-1";
    await POST(
      request("POST", {
        handle: "night_person",
        dateOfBirth: "1990-01-01",
      }),
    );

    const saved = await PATCH(
      request("PATCH", {
        gender: "self_described",
        genderSelfDescribed: "genderfluid",
        dateOfBirth: "1991-02-03",
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      complete: true,
      handle: "night_person",
      gender: "self_described",
      genderSelfDescribed: "genderfluid",
      dateOfBirth: "1991-02-03",
    });

    const cleared = await PATCH(request("PATCH", { gender: "" }));
    expect(await cleared.json()).toEqual({
      complete: true,
      handle: "night_person",
      dateOfBirth: "1991-02-03",
    });

    const reread = await GET(request());
    expect(await reread.json()).toEqual({
      complete: true,
      handle: "night_person",
      dateOfBirth: "1991-02-03",
    });
  });

  it("rejects an invalid or future date of birth edit", async () => {
    authState.userId = "user-1";
    await POST(
      request("POST", {
        handle: "night_person",
        dateOfBirth: "1990-01-01",
      }),
    );

    const invalid = await PATCH(request("PATCH", { dateOfBirth: "not-a-date" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: "Enter a valid date of birth.",
    });

    const future = await PATCH(request("PATCH", { dateOfBirth: "2999-01-01" }));
    expect(future.status).toBe(400);

    const reread = await GET(request());
    expect(await reread.json()).toMatchObject({ dateOfBirth: "1990-01-01" });
  });

  it("lets a claim-path account with no identity row save its date of birth", async () => {
    // THE DEADLOCK, verified in production against @karan: a handle claimed
    // through the early path stores no date of birth, so there is no
    // private_account_identities row. The save that would have created one was
    // refused for the row's own absence ("Finish account setup"), and the
    // Social adult check then had no date to read. The save CREATES the row.
    authState.userId = "user-claim-path";
    await memoryProfileStore.createOwned("early_claimer", "user-claim-path");

    const before = await GET(request());
    expect(await before.json()).toEqual({ complete: false, handle: "early_claimer" });

    const saved = await PATCH(request("PATCH", { dateOfBirth: "1990-01-01" }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      complete: true,
      handle: "early_claimer",
      dateOfBirth: "1990-01-01",
    });

    // The row exists now, and the one adult gate reads it.
    const readBack = await GET(request());
    const details = (await readBack.json()) as { dateOfBirth?: string };
    expect(details.dateOfBirth).toBe("1990-01-01");
    expect(
      accountIsAdult({ dateOfBirth: details.dateOfBirth ?? null }, Date.parse(NOW)),
    ).toBe(true);
  });

  it("names the missing date of birth rather than the missing setup", async () => {
    // A first save has to carry the date the row is built around, and that is a
    // different finding from having no profile at all.
    authState.userId = "user-claim-path";
    await memoryProfileStore.createOwned("early_claimer", "user-claim-path");

    const nameOnly = await PATCH(request("PATCH", { fullName: "Karan Founder" }));
    expect(nameOnly.status).toBe(400);
    expect(await nameOnly.json()).toMatchObject({
      code: "INVALID",
      error: "Add your date of birth to save private details.",
    });

    authState.userId = "user-no-profile";
    const noProfile = await PATCH(request("PATCH", { dateOfBirth: "1990-01-01" }));
    expect(noProfile.status).toBe(409);
    expect(await noProfile.json()).toMatchObject({
      code: "CONFLICT",
      error: "Claim your handle before saving private details.",
    });
  });

  it("stores an under-18 date without blocking signup", async () => {
    authState.userId = "user-young";
    const response = await POST(
      request("POST", {
        handle: "young_person",
        dateOfBirth: "2015-02-03",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "young_person",
      foundingMemberNumber: 1,
      dateOfBirth: "2015-02-03",
    });
  });
});
