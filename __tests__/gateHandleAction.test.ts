import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

import { callerUserId } from "@/lib/authServer";
import { gateHandleAction } from "@/lib/profileOwnership";
import { memoryProfileStore, __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

const mockedCaller = vi.mocked(callerUserId);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  mockedCaller.mockReset();
  mockedCaller.mockResolvedValue(null);
});

function req(init?: RequestInit): Request {
  return new Request("http://localhost/api/test", init);
}

describe("gateHandleAction", () => {
  it("400s a blank handle", async () => {
    const gate = await gateHandleAction(req(), "   ");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(400);
  });

  it("allows an anonymous caller on an unlinked handle (demo path)", async () => {
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(true);
  });

  it("REJECTS an anonymous caller on a linked handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("allows the matching owner and is idempotent when already linked", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    mockedCaller.mockResolvedValue("user-abc");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(true);
  });

  it("does not link on authenticated read of an unlinked handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const gate = await gateHandleAction(req(), "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row).toBeNull();
  });

  it("links on first authenticated write of an unlinked handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const gate = await gateHandleAction(req({ method: "POST" }), "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row?.userId).toBe("user-new");
  });

  it.each(["karan", "sarah", "carol", "erin"])(
    "never links reserved handle %s on authenticated write",
    async (handle) => {
      mockedCaller.mockResolvedValue("user-new");

      const gate = await gateHandleAction(req({ method: "POST" }), handle);

      expect(gate).toMatchObject({
        allowed: false,
        status: 409,
        error: "That handle is not available.",
      });
      expect((await memoryProfileStore.getByHandle(handle))?.userId).toBeUndefined();
    },
  );

  it.each(["karan", "Karan", "KARAN"])(
    "allows the owner to save reserved handle %s idempotently",
    async (handle) => {
      await __seedMemoryOwnedProfile("karan", "founder-user");
      mockedCaller.mockResolvedValue("founder-user");

      const gate = await gateHandleAction(req({ method: "PATCH" }), handle);

      expect(gate.allowed).toBe(true);
      if (gate.allowed) expect(gate.callerUserId).toBe("founder-user");
    },
  );

  it("REJECTS a different signed-in user on a linked handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    mockedCaller.mockResolvedValue("user-xyz");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("returns 409 when a concurrent claim takes an absent handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const createSpy = vi
      .spyOn(memoryProfileStore, "createOwned")
      .mockRejectedValueOnce(new Error("That handle is not available."));
    const gate = await gateHandleAction(req({ method: "POST" }), "racy");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(409);
    createSpy.mockRestore();
  });

  it("returns 409 when the account already owns another handle", async () => {
    await memoryProfileStore.createOwned("owned_name", "user-new");
    mockedCaller.mockResolvedValue("user-new");

    const gate = await gateHandleAction(req({ method: "POST" }), "second_name");

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(409);
  });
});
