import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { requireLinkedActor, resolveMessageHandle } from "@/lib/messageAuth";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
});

describe("requireLinkedActor (Wave I2)", () => {
  it("401s without a JWT", async () => {
    const gate = await requireLinkedActor(new Request("http://localhost"), "ken");
    expect(gate).toEqual({
      ok: false,
      status: 401,
      error: "Sign in to message.",
    });
  });

  it("returns the linked handle when JWT owns a profile", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    authState.userId = "user-ken";
    const gate = await requireLinkedActor(new Request("http://localhost"), "mallory");
    expect(gate).toEqual({ ok: true, handle: "ken", userId: "user-ken" });
  });

  it("returns an asserted new handle when JWT has no linked profile yet", async () => {
    authState.userId = "user-new";
    const gate = await requireLinkedActor(new Request("http://localhost"), "ken");
    expect(gate).toEqual({ ok: true, handle: "ken", userId: "user-new" });
  });

  it("400s when signed in but no handle to claim yet", async () => {
    authState.userId = "user-new";
    const gate = await requireLinkedActor(new Request("http://localhost"), "");
    expect(gate).toEqual({
      ok: false,
      status: 400,
      error: "Add your handle.",
    });
  });
});

describe("resolveMessageHandle", () => {
  it("prefers the auth-linked handle over the asserted one", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    authState.userId = "user-ken";
    const handle = await resolveMessageHandle(new Request("http://localhost"), "mallory");
    expect(handle).toBe("ken");
  });

  it("falls back to the asserted handle when unsigned", async () => {
    const handle = await resolveMessageHandle(new Request("http://localhost"), "@Ken");
    expect(handle).toBe("ken");
  });
});
