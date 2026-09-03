import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getByHandle = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const configured = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByHandle }),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => configured.value,
    getSupabaseAdmin: () => ({
      auth: { admin: { getUserById } },
      rpc,
    }),
  };
});

beforeEach(() => {
  configured.value = true;
  getByHandle.mockReset();
  getUserById.mockReset();
  rpc.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAuthEmailForHandle", () => {
  it("resolves the same account whatever case the handle was typed in", async () => {
    const { resolveAuthEmailForHandle } = await import("@/lib/handlePasswordSignIn");
    getByHandle.mockResolvedValue({ userId: "user-1" });
    getUserById.mockResolvedValue({
      data: { user: { email: "owner@example.com" } },
      error: null,
    });

    // iOS capitalises the first letter of a text field. That may never be the
    // reason a sign-in fails.
    for (const typed of ["karan", "Karan", "KARAN", " @KaRaN ", "@karan"]) {
      getByHandle.mockClear();
      await expect(resolveAuthEmailForHandle(typed)).resolves.toBe(
        "owner@example.com",
      );
      expect(getByHandle).toHaveBeenCalledWith("karan");
    }
  });

  it("answers null for a handle nobody owns, and never throws it back", async () => {
    const { resolveAuthEmailForHandle } = await import("@/lib/handlePasswordSignIn");
    getByHandle.mockResolvedValue(null);
    await expect(resolveAuthEmailForHandle("ghost")).resolves.toBeNull();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("answers null for a profile with no linked account", async () => {
    const { resolveAuthEmailForHandle } = await import("@/lib/handlePasswordSignIn");
    getByHandle.mockResolvedValue({ userId: null });
    await expect(resolveAuthEmailForHandle("legacy")).resolves.toBeNull();
  });

  it("answers null for an empty handle without asking the store", async () => {
    const { resolveAuthEmailForHandle } = await import("@/lib/handlePasswordSignIn");
    await expect(resolveAuthEmailForHandle("!!!")).resolves.toBeNull();
    expect(getByHandle).not.toHaveBeenCalled();
  });
});

describe("accountHasPassword", () => {
  it("reports the boolean the read answered with", async () => {
    const { accountHasPassword } = await import("@/lib/handlePasswordSignIn");
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(accountHasPassword("user-1")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("account_has_password", {
      p_user_id: "user-1",
    });

    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(accountHasPassword("user-1")).resolves.toBe(false);
  });

  it("says it could not tell rather than guessing", async () => {
    const { accountHasPassword } = await import("@/lib/handlePasswordSignIn");

    // The migration is not applied yet.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "function public.account_has_password does not exist" },
    });
    await expect(accountHasPassword("user-1")).resolves.toBeNull();

    // The read threw.
    rpc.mockRejectedValueOnce(new Error("network"));
    await expect(accountHasPassword("user-1")).resolves.toBeNull();

    // The answer was not a boolean.
    rpc.mockResolvedValueOnce({ data: "yes", error: null });
    await expect(accountHasPassword("user-1")).resolves.toBeNull();

    // No account to ask about.
    await expect(accountHasPassword("")).resolves.toBeNull();

    // Supabase is not configured on this build.
    configured.value = false;
    await expect(accountHasPassword("user-1")).resolves.toBeNull();
  });
});

describe("signInWithEmailPassword", () => {
  const ENV = {
    NEXT_PUBLIC_SUPABASE_URL: "https://mock-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };

  beforeEach(() => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the session tokens on a grant", async () => {
    const { signInWithEmailPassword } = await import("@/lib/handlePasswordSignIn");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        }),
      ),
    );
    await expect(
      signInWithEmailPassword("owner@example.com", "Pubmaxx1!"),
    ).resolves.toMatchObject({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
  });

  it("lets a refused grant's body go rather than leaving it open", async () => {
    const { signInWithEmailPassword } = await import("@/lib/handlePasswordSignIn");
    const refused = Response.json({ error: "invalid" }, { status: 400 });
    const cancel = vi.spyOn(refused.body as ReadableStream, "cancel");
    vi.stubGlobal("fetch", vi.fn(async () => refused));

    await expect(
      signInWithEmailPassword("owner@example.com", "Pubmaxx1!"),
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("does not spend a request on a password below the length floor", async () => {
    const { signInWithEmailPassword } = await import("@/lib/handlePasswordSignIn");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      signInWithEmailPassword("owner@example.com", "short"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a password that predates the character rules", async () => {
    // The character rules govern what a person may CREATE. Refusing an older
    // password at our own door would lock an owner out of their account.
    const { signInWithEmailPassword } = await import("@/lib/handlePasswordSignIn");
    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: "a", refresh_token: "r" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      signInWithEmailPassword("owner@example.com", "allsmallnodigits"),
    ).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});
