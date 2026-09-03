import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { DELETE as DELETE_PAL, PATCH as PATCH_PAL, POST as CREATE_PAL } from "@/app/api/pub-pal/route";
import { GET as LIST_MEMORIES, POST as CREATE_MEMORY } from "@/app/api/pub-pal/memories/route";
import { DELETE as DELETE_MEMORY, PATCH as PATCH_MEMORY } from "@/app/api/pub-pal/memories/[memoryId]/route";
import { GET as EXPORT_MEMORIES } from "@/app/api/pub-pal/memories/export/route";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { __resetPubPalStore } from "@/lib/pubPalStore";

const auth = (path: string, body?: unknown, token = "pal-owner", method?: string) => new Request(`http://localhost${path}`, {
  method: method ?? (body === undefined ? "GET" : "POST"),
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) });

describe("Pub Pal memory ownership HTTP contract", () => {
  beforeEach(() => __resetPubPalStore());

  async function createPal() {
    const response = await CREATE_PAL(auth("/api/pub-pal", {
      ...DEFAULT_PAL_DRAFT,
      adultConfirmed: true,
      name: "Morrow",
      proposalPreferences: { memories: true, routes: false },
    }));
    expect(response.status).toBe(201);
    return (await response.json()).pal;
  }

  it("persists proposal preferences and lets the owner disable either proposal channel", async () => {
    const pal = await createPal();
    expect(pal.proposalPreferences).toEqual({ memories: true, routes: false });
    const response = await PATCH_PAL(auth("/api/pub-pal", {
      proposalPreferences: { memories: false, routes: true },
    }, "pal-owner", "PATCH"));
    expect(response.status).toBe(200);
    expect((await response.json()).pal.proposalPreferences).toEqual({ memories: false, routes: true });
  });

  it("corrects, exports, and explicitly deletes only the owner's confirmed memory", async () => {
    await createPal();
    const created = await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "venue_preference", value: "Likes quiet corners" }));
    expect(created.status).toBe(201);
    const memory = (await created.json()).memory;

    const forbidden = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, { value: "Tampered" }, "other-owner", "PATCH"), ctx(memory.id));
    expect(forbidden.status).toBe(404);

    const corrected = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, { value: "Prefers a quiet table away from speakers" }, "pal-owner", "PATCH"), ctx(memory.id));
    expect(corrected.status).toBe(200);
    expect(await corrected.json()).toMatchObject({ memory: { id: memory.id, provenance: "user_correction", value: "Prefers a quiet table away from speakers" } });

    const exported = await EXPORT_MEMORIES(auth("/api/pub-pal/memories/export"));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    const exportBody = await exported.json();
    expect(exportBody).toMatchObject({ version: 1, pal: { name: "Morrow", species: DEFAULT_PAL_DRAFT.appearance.species }, memories: [{ id: memory.id, provenance: "user_correction" }] });
    expect(JSON.stringify(exportBody)).not.toContain("pal-owner");
    expect(JSON.stringify(exportBody)).not.toContain('"palId"');

    const deleted = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, undefined, "pal-owner", "DELETE"), ctx(memory.id));
    expect(deleted.status).toBe(200);
    const replay = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, undefined, "pal-owner", "DELETE"), ctx(memory.id));
    expect(replay.status).toBe(404);
    await expect((await LIST_MEMORIES(auth("/api/pub-pal/memories"))).json()).resolves.toMatchObject({ memories: [] });
  });

  it("deleting the Pal removes its confirmed memory context in keyless mode", async () => {
    await createPal();
    await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "drink_preference", value: "Zero-proof first" }));
    expect((await DELETE_PAL(auth("/api/pub-pal", undefined, "pal-owner", "DELETE"))).status).toBe(200);
    await expect((await LIST_MEMORIES(auth("/api/pub-pal/memories"))).json()).resolves.toMatchObject({ memories: [] });
  });
});
