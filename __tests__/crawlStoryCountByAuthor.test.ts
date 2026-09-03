import { beforeEach, describe, expect, it, vi } from "vitest";

// Published crawl-story count by author — the number the Pint Passport shows for
// a handle on /u/[handle]. Covers both the store helper and the GET ?author=
// route branch. In-memory path pinned at the @/lib/supabase seam
// (isSupabaseConfigured() === false) — NOT via a NODE_ENV stub, which Vite bakes
// at transform time (a runtime stub is a silent no-op under a production build;
// backend selection reads SUPABASE_*, never NODE_ENV). See profileOwnershipRoute /
// pintDrops for the house pattern.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// The ONLY thing stubbed on the ownership chain is the JWT read. Everything
// after it - resolveMessageHandle, the profile store's user-id link, the
// handle comparison - runs for real, because that chain is what decides
// whether an owner's unlisted crawls are disclosed.
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => auth.userId,
}));
vi.mock("@/lib/venueAliases", () => ({
  resolveCanonicalVenueId: async (id: string) =>
    id === "legacy-a"
      ? "venue-a"
      : id === "legacy-bar"
        ? "bar-a"
        : id,
}));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => {
    const canonicalId =
      id === "legacy-a" ? "venue-a" : id === "legacy-bar" ? "bar-a" : id;
    if (canonicalId === "unavailable-a") {
      return { status: "unavailable" as const, canonicalId };
    }
    const venue =
      canonicalId === "bar-a"
        ? {
            id: canonicalId,
            name: "Test Cocktail Bar",
            borough: "London",
            lat: 51.5,
            lng: -0.12,
            kind: "bar" as const,
          }
        : {
            id: canonicalId,
            name: "The Test Arms",
            borough: "London",
            lat: 51.5,
            lng: -0.12,
          };
    return { status: "found" as const, canonicalId, venue };
  },
  getVenueIndex: async () => {
    const venues = new Map([
      [
        "venue-a",
        {
          id: "venue-a",
          name: "The Test Arms",
          borough: "London",
          lat: 51.5,
          lng: -0.12,
        },
      ],
      [
        "bar-a",
        {
          id: "bar-a",
          name: "Test Cocktail Bar",
          borough: "London",
          lat: 51.5,
          lng: -0.12,
          kind: "bar",
        },
      ],
    ]);
    return venues;
  },
  resolveVenue: async (id: string) =>
    id === "venue-a"
      ? {
          id,
          name: "The Test Arms",
          borough: "London",
          lat: 51.5,
          lng: -0.12,
        }
      : null,
  venueMapUrl: (id: string) => `/map?sel=${encodeURIComponent(id)}`,
}));

import { GET, POST } from "@/app/api/crawls/route";
import {
  __resetCrawlStories,
  createCrawlStory,
  listAuthoredCrawlPage,
  listOwnUnlistedCrawlPage,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/crawls";

async function makeStory(authorHandle?: string, title = "The Loop"): Promise<string> {
  const res = await createCrawlStory({
    title,
    ...(authorHandle ? { authorHandle } : {}),
    stops: [{ venueId: "venue-a" }],
  });
  if (!res) throw new Error("story did not save");
  return res.slug;
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCrawlStories();
  __resetPintDrops();
  __resetMemoryProfiles();
  auth.userId = null;
});

describe("listAuthoredCrawlPage rows", () => {
  it("returns stop counts from stored stops in the memory backend", async () => {
    await createCrawlStory({
      title: "Three stop loop",
      authorHandle: "ken",
      stops: [{ venueId: "v1" }, { venueId: "v2" }, { venueId: "v3" }],
    });
    const listed = (await listAuthoredCrawlPage("ken")).crawls;
    expect(listed.length).toBe(1);
    expect(listed[0].stops).toBe(3);
  });
});

// ONE query owns the public visibility rule, so the number and the rows it
// links to cannot disagree. These assertions used to sit on a second,
// independent count nothing user-facing exercised.
describe("listAuthoredCrawlPage — the public count and its rows", () => {
  it("counts a handle's published crawls, normalizing the handle", async () => {
    await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    await makeStory("someone_else", "Their Loop");
    expect((await listAuthoredCrawlPage("ken")).total).toBe(2);
    expect((await listAuthoredCrawlPage("  KEN ")).total).toBe(2); // normalized
    expect((await listAuthoredCrawlPage("someone_else")).total).toBe(1);
  });

  it("is 0 for a handle with no crawls, an anonymous author, or a blank handle", async () => {
    await makeStory(undefined, "Anon Loop"); // anonymous — no author
    expect(await listAuthoredCrawlPage("nobody")).toEqual({ crawls: [], total: 0 });
    expect(await listAuthoredCrawlPage("")).toEqual({ crawls: [], total: 0 });
  });

  it("excludes draft crawls (only public crawls count as posts)", async () => {
    const slug = await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    expect((await listAuthoredCrawlPage("ken")).total).toBe(2);
    await updateCrawlStory(slug, "ken", { visibility: "draft" });
    const page = await listAuthoredCrawlPage("ken");
    expect(page.total).toBe(1);
    expect(page.crawls.length).toBe(1);
  });

  // The profile's Crawls tile links to the section this page renders, so the
  // count may never claim a crawl the listing withholds. An unlisted crawl is a
  // direct link and belongs to neither.
  it("excludes unlisted crawls from both the count and the rows", async () => {
    const slug = await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    await updateCrawlStory(slug, "ken", { visibility: "unlisted" });
    const page = await listAuthoredCrawlPage("ken");
    expect(page.total).toBe(1);
    expect(page.crawls.map((crawl) => crawl.title)).toEqual(["Loop Two"]);
  });

  it("counts 0 when every crawl a handle wrote is unlisted, so the tile links nowhere it cannot open", async () => {
    const slug = await makeStory("ken", "Only Loop");
    await updateCrawlStory(slug, "ken", { visibility: "unlisted" });
    expect(await listAuthoredCrawlPage("ken")).toEqual({ crawls: [], total: 0 });
  });

  it("counts every crawl while listing one page of them", async () => {
    for (let i = 0; i < 11; i += 1) {
      await makeStory("ken", `Loop ${i}`);
    }
    const page = await listAuthoredCrawlPage("ken");
    expect(page.total).toBe(11);
    expect(page.crawls.length).toBe(10);
    expect(page.total).toBeGreaterThan(page.crawls.length);
  });
});

// The passport's story-posts number is what this author PUBLISHED, and an
// unlisted crawl is published — shared by direct link. Narrowing it to `public`
// alongside the crawls tile would tell an owner they wrote fewer than they did,
// so the owner's lane carries the ROWS behind that difference.
describe("listOwnUnlistedCrawlPage", () => {
  it("carries the crawls the public lane withholds, as rows", async () => {
    const unlisted = await makeStory("ken", "Direct Link Only");
    await makeStory("ken", "Listed");
    await updateCrawlStory(unlisted, "ken", { visibility: "unlisted" });

    const own = await listOwnUnlistedCrawlPage("ken");
    expect(own.total).toBe(1);
    expect(own.crawls.map((crawl) => crawl.title)).toEqual(["Direct Link Only"]);
    expect((await listAuthoredCrawlPage("ken")).total).toBe(1);
  });

  it("still never carries a draft", async () => {
    const slug = await makeStory("ken", "Half Written");
    await updateCrawlStory(slug, "ken", { visibility: "draft" });
    expect(await listOwnUnlistedCrawlPage("ken")).toEqual({ crawls: [], total: 0 });
  });
});

describe("GET /api/crawls?author=", () => {
  it("returns the normalized handle and its published story count", async () => {
    await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    const res = await GET(new Request(`${URL_BASE}?author=${encodeURIComponent("  Ken ")}`));
    expect(res.status).toBe(200);
    // `crawls` rides beside the count so the profile can OPEN what it counts.
    const body = (await res.json()) as {
      handle: string;
      count: number;
      total: number;
      hasMore: boolean;
      crawls: { slug: string; title: string }[];
    };
    expect(body.handle).toBe("ken");
    expect(body.count).toBe(2);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);
    expect(body.crawls.map((crawl) => crawl.title).sort()).toEqual([
      "Loop One",
      "Loop Two",
    ]);
  });

  it("never claims N stories while listing only the first page", async () => {
    for (let i = 0; i < 11; i += 1) {
      await makeStory("ken", `Loop ${i}`);
    }
    const res = await GET(new Request(`${URL_BASE}?author=ken`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      total: number;
      hasMore: boolean;
      crawls: unknown[];
    };
    expect(body.count).toBe(11);
    expect(body.total).toBe(11);
    expect(body.crawls.length).toBe(10);
    expect(body.hasMore).toBe(true);
  });

  it("returns count 0 for a handle with no stories", async () => {
    const res = await GET(new Request(`${URL_BASE}?author=nobody`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      handle: "nobody",
      count: 0,
      total: 0,
      crawls: [],
      hasMore: false,
      status: "ready",
    });
  });

  it("returns handle '' and count 0 for a blank author param", async () => {
    const res = await GET(new Request(`${URL_BASE}?author=`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      handle: "",
      count: 0,
      total: 0,
      crawls: [],
      hasMore: false,
      status: "ready",
    });
  });

  // The profile pages with ?limit=, so a reader can reach past the first page
  // rather than reading a tile count above a list that stops at ten.
  it("honours ?limit= up to the published ceiling and clamps past it", async () => {
    for (let i = 0; i < 30; i += 1) {
      await makeStory("ken", `Loop ${String(i).padStart(2, "0")}`);
    }

    const widened = (await (
      await GET(new Request(`${URL_BASE}?author=ken&limit=25`))
    ).json()) as { crawls: unknown[]; total: number; hasMore: boolean };
    expect(widened.crawls.length).toBe(25);
    expect(widened.total).toBe(30);
    expect(widened.hasMore).toBe(true);

    const clamped = (await (
      await GET(new Request(`${URL_BASE}?author=ken&limit=500`))
    ).json()) as { crawls: unknown[] };
    expect(clamped.crawls.length).toBe(25);

    const junk = (await (
      await GET(new Request(`${URL_BASE}?author=ken&limit=nope`))
    ).json()) as { crawls: unknown[] };
    expect(junk.crawls.length).toBe(10);
  });

  // An unlisted crawl is a direct-link crawl, so how many of them somebody has
  // is theirs to know. An anonymous caller asking for the owner scope is simply
  // not answered — no field, no error.
  it("never hands the owner-scoped count to an anonymous caller", async () => {
    const slug = await makeStory("ken", "Only Loop");
    await updateCrawlStory(slug, "ken", { visibility: "unlisted" });

    const res = await GET(new Request(`${URL_BASE}?author=ken&scope=own`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ownCount).toBeUndefined();
    expect(body.unlisted).toBeUndefined();
    expect(body.unlistedTotal).toBeUndefined();
    expect(body.count).toBe(0);
    expect(body.crawls).toEqual([]);
  });

  // The other side of the same gate: the verified owner IS answered, and what
  // they get back is the unlisted crawl itself, not only a number. Without
  // this, the whole branch could stop firing and the owner's passport would
  // quietly fall back to the public count with nothing failing.
  it("hands the verified owner the unlisted crawls the public lane withholds", async () => {
    const unlisted = await makeStory("ken", "Direct Link Only");
    await makeStory("ken", "Listed");
    await updateCrawlStory(unlisted, "ken", { visibility: "unlisted" });
    await memoryProfileStore.createOwned("ken", "user-ken");
    auth.userId = "user-ken";

    const body = (await (
      await GET(new Request(`${URL_BASE}?author=ken&scope=own`))
    ).json()) as {
      ownCount: number;
      count: number;
      crawls: unknown[];
      unlisted: Array<{ slug: string; title: string }>;
      unlistedTotal: number;
    };

    expect(body.ownCount).toBe(2);
    expect(body.count).toBe(1);
    expect(body.crawls).toHaveLength(1);
    // The number opens something: the row behind the difference travels with it.
    expect(body.unlistedTotal).toBe(1);
    expect(body.unlisted.map((crawl) => crawl.title)).toEqual(["Direct Link Only"]);
    expect(body.ownCount).toBe(body.count + body.unlistedTotal);
  });

  // The public page the owner scope also answers is not the one rendered, so
  // the client trims it. Trimming may never change the numbers.
  it("answers the same owner figures however small the public page is", async () => {
    for (let i = 0; i < 12; i += 1) await makeStory("ken", `Loop ${i}`);
    const unlisted = await makeStory("ken", "Direct Link Only");
    await updateCrawlStory(unlisted, "ken", { visibility: "unlisted" });
    await memoryProfileStore.createOwned("ken", "user-ken");
    auth.userId = "user-ken";

    const trimmed = (await (
      await GET(new Request(`${URL_BASE}?author=ken&scope=own&limit=1`))
    ).json()) as Record<string, unknown>;

    expect(trimmed.crawls).toHaveLength(1);
    expect(trimmed.count).toBe(12);
    expect(trimmed.ownCount).toBe(13);
    expect(trimmed.unlistedTotal).toBe(1);
    expect(trimmed.unlisted).toHaveLength(1);
  });

  // THE LINE OVER THOSE ROWS NAMES A TOTAL, NOT A PAGE.
  //
  // The owner's unlisted rows are a page like every other, so an owner with more
  // than one page of them used to be told they had exactly as many as the page
  // happened to carry, while the passport tally beside it counted them all. The
  // whole total and a short-page flag now travel with the rows.
  it("names the whole unlisted total and says the page is short of it", async () => {
    for (let i = 0; i < 30; i += 1) {
      const slug = await makeStory("ken", `Direct ${String(i).padStart(2, "0")}`);
      await updateCrawlStory(slug, "ken", { visibility: "unlisted" });
    }
    await makeStory("ken", "Listed");
    await memoryProfileStore.createOwned("ken", "user-ken");
    auth.userId = "user-ken";

    const first = (await (
      await GET(new Request(`${URL_BASE}?author=ken&scope=own&limit=1`))
    ).json()) as {
      ownCount: number;
      unlisted: unknown[];
      unlistedTotal: number;
      unlistedHasMore: boolean;
    };

    expect(first.unlisted).toHaveLength(10);
    expect(first.unlistedTotal).toBe(30);
    expect(first.unlistedHasMore).toBe(true);
    expect(first.ownCount).toBe(31);

    // Its own bound: the public page in this same reply is trimmed to one row,
    // and that trim may not size the unlisted lane.
    const widened = (await (
      await GET(
        new Request(`${URL_BASE}?author=ken&scope=own&limit=1&unlistedLimit=25`),
      )
    ).json()) as {
      crawls: unknown[];
      unlisted: unknown[];
      unlistedTotal: number;
      unlistedHasMore: boolean;
    };

    expect(widened.crawls).toHaveLength(1);
    expect(widened.unlisted).toHaveLength(25);
    expect(widened.unlistedTotal).toBe(30);
    expect(widened.unlistedHasMore).toBe(true);

    const clamped = (await (
      await GET(
        new Request(`${URL_BASE}?author=ken&scope=own&unlistedLimit=500`),
      )
    ).json()) as { unlisted: unknown[] };
    expect(clamped.unlisted).toHaveLength(25);
  });

  it("says nothing is behind a page that holds every unlisted crawl", async () => {
    const slug = await makeStory("ken", "Direct Link Only");
    await updateCrawlStory(slug, "ken", { visibility: "unlisted" });
    await memoryProfileStore.createOwned("ken", "user-ken");
    auth.userId = "user-ken";

    const body = (await (
      await GET(new Request(`${URL_BASE}?author=ken&scope=own`))
    ).json()) as { unlistedTotal: number; unlistedHasMore: boolean };

    expect(body.unlistedTotal).toBe(1);
    expect(body.unlistedHasMore).toBe(false);
  });

  it("refuses the owner scope to a signed-in stranger", async () => {
    const unlisted = await makeStory("ken", "Direct Link Only");
    await updateCrawlStory(unlisted, "ken", { visibility: "unlisted" });
    await memoryProfileStore.createOwned("ken", "user-ken");
    await memoryProfileStore.createOwned("pat", "user-pat");
    auth.userId = "user-pat";

    const body = (await (
      await GET(new Request(`${URL_BASE}?author=ken&scope=own`))
    ).json()) as Record<string, unknown>;

    expect(body.ownCount).toBeUndefined();
    expect(body.unlisted).toBeUndefined();
  });

  it("answers no owner count unless the scope was asked for", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    await makeStory("ken", "Listed");
    auth.userId = "user-ken";

    const body = (await (
      await GET(new Request(`${URL_BASE}?author=ken`))
    ).json()) as Record<string, unknown>;

    expect(body.ownCount).toBeUndefined();
    expect(body.unlisted).toBeUndefined();
  });
});

describe("POST /api/crawls", () => {
  function post(stops: Array<{ venueId: string }>): Promise<Response> {
    return POST(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({ title: "Test crawl", stops }),
      }),
    );
  }

  it("accepts a legacy pub stop", async () => {
    expect((await post([{ venueId: "venue-a" }])).status).toBe(201);
  });

  it("canonicalizes a legacy pub alias before validation and persistence", async () => {
    const saved = await post([{ venueId: "legacy-a" }]);
    expect(saved.status).toBe(201);
    const { slug } = await saved.json();
    const fetched = await GET(
      new Request(`${URL_BASE}?slug=${encodeURIComponent(slug)}`),
    );
    const { story } = await fetched.json();
    expect(story.stops[0].venueId).toBe("venue-a");
    expect(story.stops[0].venueName).toBe("The Test Arms");
  });

  it("rejects a cocktail bar before saving the crawl", async () => {
    expect((await post([{ venueId: "bar-a" }])).status).toBe(400);
    expect((await listAuthoredCrawlPage("nobody")).total).toBe(0);
  });

  it("rejects a legacy alias that resolves to a cocktail bar", async () => {
    expect((await post([{ venueId: "legacy-bar" }])).status).toBe(400);
  });

  it("returns unavailable when a stop's city pack cannot load", async () => {
    const response = await post([{ venueId: "unavailable-a" }]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Venue list is unavailable right now, try again shortly.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });
});
