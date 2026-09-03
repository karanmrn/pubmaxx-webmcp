import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/crawls/[slug]/route.ts — author-gated
// edit/delete (story 35). In-memory path pinned at the @/lib/supabase seam
// (isSupabaseConfigured() === false) — NOT via a NODE_ENV stub, which Vite bakes
// at transform time (a runtime stub is a silent no-op under a production build;
// backend selection reads SUPABASE_*, never NODE_ENV). See profileOwnershipRoute /
// pintDrops for the house pattern.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { DELETE, GET, PATCH } from "@/app/api/crawls/[slug]/route";
import { __resetCrawlStories, createCrawlStory } from "@/lib/crawlStoryStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/crawls";

async function makeStory(authorHandle?: string): Promise<string> {
  const res = await createCrawlStory({
    title: "The Loop",
    ...(authorHandle ? { authorHandle } : {}),
    stops: [{ venueId: "venue-a" }],
  });
  if (!res) throw new Error("story did not save");
  return res.slug;
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCrawlStories();
  __resetMemoryProfiles();
});

describe("PATCH /api/crawls/[slug]", () => {
  it("lets the author edit the title", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "ken", title: "New Title" }),
    });
    const res = await PATCH(req, params(slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { story: { title: string } };
    expect(body.story.title).toBe("New Title");
  });

  it("403s a non-author edit", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "intruder", title: "Hijack" }),
    });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });

  it("403s a missing handle", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, { method: "PATCH", body: JSON.stringify({}) });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });

  it("403s when the author handle is linked and the caller is anonymous", async () => {
    const slug = await makeStory("ken");
    await memoryProfileStore.createOwned("ken", "user-abc");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "ken", title: "Hijack" }),
    });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });
});

describe("DELETE /api/crawls/[slug]", () => {
  it("lets the author delete", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "DELETE",
      body: JSON.stringify({ handle: "ken" }),
    });
    expect((await DELETE(req, params(slug))).status).toBe(200);
  });

  it("403s a non-author delete", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "DELETE",
      body: JSON.stringify({ handle: "intruder" }),
    });
    expect((await DELETE(req, params(slug))).status).toBe(403);
  });
});

describe("GET /api/crawls/[slug] — author", () => {
  it("reports the author handle", async () => {
    const slug = await makeStory("ken");
    const res = await GET(new Request(`${URL_BASE}/${slug}`), params(slug));
    expect(await res.json()).toEqual({ author: "ken" });
  });
});
