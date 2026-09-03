import { beforeEach, describe, expect, it } from "vitest";

// Crawl-story authorship: attribution + author-gated edit/delete (story 35).
// FORCE the in-memory path (clear Supabase env) so these run offline everywhere,
// and reset the memory store between cases.
import {
  __resetCrawlStories,
  createCrawlStory,
  deleteCrawlStory,
  getCrawlStoryBySlug,
  getStoryAuthor,
  isAuthor,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCrawlStories();
  __resetMemoryProfiles();
});

async function makeStory(authorHandle?: string) {
  const res = await createCrawlStory({
    title: "The Bloomsbury Loop",
    ...(authorHandle ? { authorHandle } : {}),
    stops: [{ venueId: "venue-a" }, { venueId: "venue-b" }],
  });
  if (!res) throw new Error("story did not save");
  return res;
}

describe("attribution", () => {
  it("attributes a story to the author's normalized handle", async () => {
    const { slug } = await makeStory("  Ken ");
    expect(await getStoryAuthor(slug)).toBe("ken");
    const story = await getCrawlStoryBySlug(slug);
    expect(story!.authorHandle).toBe("ken");
  });

  it("leaves an anonymous story with a null author", async () => {
    const { slug } = await makeStory();
    expect(await getStoryAuthor(slug)).toBeNull();
    const story = await getCrawlStoryBySlug(slug);
    expect(story!.authorHandle).toBeNull();
  });
});

describe("isAuthor — the edit/delete gate", () => {
  it("is true only for the exact author handle", async () => {
    const { slug } = await makeStory("ken");
    expect(await isAuthor(slug, "ken")).toBe(true);
    expect(await isAuthor(slug, "KEN")).toBe(true); // normalized
    expect(await isAuthor(slug, "someone_else")).toBe(false);
  });

  it("is false for an anonymous story (no author to match)", async () => {
    const { slug } = await makeStory();
    expect(await isAuthor(slug, "ken")).toBe(false);
    expect(await isAuthor(slug, "")).toBe(false);
  });

  it("is false for an unknown slug", async () => {
    expect(await isAuthor("no-such-slug", "ken")).toBe(false);
  });

  it("requires matching JWT owner when the author handle is linked", async () => {
    const { slug } = await makeStory("ken");
    await memoryProfileStore.createOwned("ken", "user-abc");
    expect(await isAuthor(slug, "ken")).toBe(false);
    expect(await isAuthor(slug, "ken", "user-xyz")).toBe(false);
    expect(await isAuthor(slug, "ken", "user-abc")).toBe(true);
  });
});

describe("updateCrawlStory — author only", () => {
  it("lets the author edit head fields", async () => {
    const { slug } = await makeStory("ken");
    const updated = await updateCrawlStory(slug, "ken", { title: "A Better Title" });
    expect(updated!.title).toBe("A Better Title");
  });

  it("refuses a non-author edit (returns null, no change)", async () => {
    const { slug } = await makeStory("ken");
    const attempt = await updateCrawlStory(slug, "intruder", { title: "Hijacked" });
    expect(attempt).toBeNull();
    // The story is unchanged.
    expect((await getCrawlStoryBySlug(slug))!.title).toBe("The Bloomsbury Loop");
  });
});

describe("deleteCrawlStory — author only", () => {
  it("lets the author delete their story", async () => {
    const { slug } = await makeStory("ken");
    expect(await deleteCrawlStory(slug, "ken")).toBe(true);
    expect(await getCrawlStoryBySlug(slug)).toBeNull();
  });

  it("refuses a non-author delete (story survives)", async () => {
    const { slug } = await makeStory("ken");
    expect(await deleteCrawlStory(slug, "intruder")).toBe(false);
    expect(await getCrawlStoryBySlug(slug)).not.toBeNull();
  });

  it("refuses to delete an anonymous story (no owner)", async () => {
    const { slug } = await makeStory();
    expect(await deleteCrawlStory(slug, "ken")).toBe(false);
    expect(await getCrawlStoryBySlug(slug)).not.toBeNull();
  });
});
