import { beforeEach, describe, expect, it, vi } from "vitest";

// Linked-handle ownership across private/destructive social routes.
// Pin memory stores + no-op assertServerEnv (import-time guard on these routes).
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { PATCH as PATCH_CRAWL, DELETE as DELETE_CRAWL } from "@/app/api/crawls/[slug]/route";
import { GET as GET_MESSAGES, POST as POST_MESSAGES } from "@/app/api/messages/route";
import { GET as GET_NOTIFS, POST as POST_NOTIFS } from "@/app/api/notifications/route";
import { POST as POST_RATINGS } from "@/app/api/ratings/route";
import { POST as POST_SAVED } from "@/app/api/saved-pubs/route";
import { POST as POST_ROUNDS } from "@/app/api/rounds/route";
import { createCrawlStory, __resetCrawlStories } from "@/lib/crawlStoryStore";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetMemoryNotifications, notificationsStore } from "@/lib/notificationsStore";
import { __resetMemoryRatings } from "@/lib/ratingsStore";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";
import { __resetMemoryRounds } from "@/lib/roundsStore";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";
import { __resetPintDrops } from "@/lib/pintDrops";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  __resetCrawlStories();
  __resetMemoryMessages();
  __resetMemoryNotifications();
  __resetMemoryRatings();
  __resetMemorySavedPubs();
  __resetMemoryRounds();
  __resetPintDrops();
});

async function seedStory(author = "ken"): Promise<string> {
  const res = await createCrawlStory({
    title: "The Loop",
    authorHandle: author,
    stops: [{ venueId: "venue-a" }],
  });
  if (!res) throw new Error("story missing");
  return res.slug;
}

describe("linked-handle ownership — forged body/query handle is rejected", () => {
  it("403s crawl PATCH/DELETE when the author handle is linked and the caller is anonymous", async () => {
    const slug = await seedStory("ken");
    await memoryProfileStore.createOwned("ken", "user-abc");
    const patch = await PATCH_CRAWL(
      new Request(`http://localhost/api/crawls/${slug}`, {
        method: "PATCH",
        body: JSON.stringify({ handle: "ken", title: "Hijack" }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(patch.status).toBe(403);

    const del = await DELETE_CRAWL(
      new Request(`http://localhost/api/crawls/${slug}`, {
        method: "DELETE",
        body: JSON.stringify({ handle: "ken" }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(del.status).toBe(403);
  });

  it("401s messages inbox GET/POST for a linked handle without JWT (Wave I2)", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const get = await GET_MESSAGES(new Request("http://localhost/api/messages?handle=ken"));
    expect(get.status).toBe(401);

    const post = await POST_MESSAGES(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ action: "open", handle: "ken", other: "sam" }),
      }),
    );
    expect(post.status).toBe(401);
  });

  it("403s notifications GET/POST for a linked handle without JWT", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    await notificationsStore().emit({
      recipientHandle: "ken",
      actorHandle: "ale",
      kind: "follow",
    });
    expect((await GET_NOTIFS(new Request("http://localhost/api/notifications?handle=ken"))).status).toBe(403);
    expect(
      (
        await POST_NOTIFS(
          new Request("http://localhost/api/notifications", {
            method: "POST",
            body: JSON.stringify({ handle: "ken" }),
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("403s ratings POST for a linked handle without JWT", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const res = await POST_RATINGS(
      new Request("http://localhost/api/ratings", {
        method: "POST",
        body: JSON.stringify({ kind: "venue", ref: "v1", handle: "ken", rating: 4 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s saved-pubs POST for a linked handle without JWT", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const res = await POST_SAVED(
      new Request("http://localhost/api/saved-pubs", {
        method: "POST",
        body: JSON.stringify({ handle: "ken", venueId: "venue-a", listType: "Historic" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s rounds create for a linked handle without JWT", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const res = await POST_ROUNDS(
      new Request("http://localhost/api/rounds", {
        method: "POST",
        body: JSON.stringify({ handle: "ken", title: "Night" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("still allows unlinked-handle demo writes (anonymous path preserved)", async () => {
    const res = await POST_ROUNDS(
      new Request("http://localhost/api/rounds", {
        method: "POST",
        body: JSON.stringify({ handle: "demo", title: "Night" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
