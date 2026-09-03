import { beforeEach, describe, expect, it, vi } from "vitest";

const failureState = vi.hoisted(() => ({ palLookupFails: false }));

vi.mock("@/lib/authServer", () => ({ callerUserId: async () => "pal-owner" }));
vi.mock("@/lib/pubPalStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalStore")>();
  return {
    ...actual,
    getPubPalResult: async () => failureState.palLookupFails ? { ok: false as const, error: "error" as const } : { ok: true as const, value: ({
      id: "pal-id",
      ownerId: "pal-owner",
      name: "Morrow",
      adultAttestedAt: new Date(0).toISOString(),
      appearance: { species: "greyhound", signalAffinity: "beer", material: "hologram", accessory: "none" },
      personality: { playfulness: 50, energy: 50, storytelling: 50, relationship: "sidekick" },
      voice: { id: "ember", pace: 50, warmth: 50, energy: 50 },
      muted: false,
      hidden: false,
      proposalPreferences: { memories: false, routes: true },
      masteryPoints: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }) },
    createPubPalResult: async () => ({ ok: false as const, error: "error" as const }),
    listPalMemoriesResult: async () => ({ ok: false as const, error: "error" as const }),
    updatePalMemoryResult: async () => ({ ok: false as const, error: "error" as const }),
    deletePalMemoryResult: async () => ({ ok: false as const, error: "error" as const }),
  };
});

import { DELETE, PATCH } from "@/app/api/pub-pal/memories/[memoryId]/route";
import { GET as EXPORT } from "@/app/api/pub-pal/memories/export/route";
import { GET as GET_PAL, POST as CREATE_PAL } from "@/app/api/pub-pal/route";

const context = { params: Promise.resolve({ memoryId: "memory-id" }) };

describe("Pub Pal memory store failures", () => {
  beforeEach(() => { failureState.palLookupFails = false; });
  it("never presents a failed export as a successful empty archive", async () => {
    const response = await EXPORT(new Request("http://localhost/api/pub-pal/memories/export"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true });
  });

  it("propagates a failed owner-Pal lookup instead of reporting absence", async () => {
    failureState.palLookupFails = true;
    const response = await EXPORT(new Request("http://localhost/api/pub-pal/memories/export"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true });
  });

  it("keeps main Pal reads and creation retryable during a store outage", async () => {
    failureState.palLookupFails = true;
    const read = await GET_PAL(new Request("http://localhost/api/pub-pal"));
    expect(read.status).toBe(503);
    expect(await read.json()).toMatchObject({ code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true });
    const created = await CREATE_PAL(new Request("http://localhost/api/pub-pal", { method: "POST", body: JSON.stringify({}) }));
    expect(created.status).toBe(503);
    expect(await created.json()).toMatchObject({ code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true });
  });

  it("distinguishes update and delete store failures from missing memory", async () => {
    const patched = await PATCH(new Request("http://localhost/api/pub-pal/memories/memory-id", { method: "PATCH", body: JSON.stringify({ value: "Correction" }) }), context);
    expect(patched.status).toBe(503);
    expect(await patched.json()).toMatchObject({ code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true });
    const deleted = await DELETE(new Request("http://localhost/api/pub-pal/memories/memory-id", { method: "DELETE" }), context);
    expect(deleted.status).toBe(503);
    expect(await deleted.json()).toMatchObject({ code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true });
  });
});
