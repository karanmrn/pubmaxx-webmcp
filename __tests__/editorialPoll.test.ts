import { describe, expect, it, vi } from "vitest";

import {
  EDITORIAL_BACKOFF_MS,
  EDITORIAL_USER_AGENT,
  feedIsDue,
  interpretEditorialResponse,
} from "@/lib/editorialRss.mjs";
import {
  EDITORIAL_STATE_PATH,
  pollEditorialFeeds,
} from "../scripts/editorial/poll.mjs";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

const ONE_FEED = [
  {
    id: "deserter",
    name: "Deserter",
    url: "https://deserter.co.uk/feed/",
    site: "https://deserter.co.uk",
    cadenceHours: 84,
    licence: "rss-std",
  },
] as const;

function rssItem(title: string, link: string) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><item>
    <title>${title}</title>
    <link>${link}</link>
    <pubDate>Sat, 16 Aug 2026 09:00:00 GMT</pubDate>
    <description>A note.</description>
    <content:encoded>&lt;p&gt;FULL BODY&lt;/p&gt;</content:encoded>
  </item></channel></rss>`;
}

describe("editorial poller: due / backoff / interpret", () => {
  it("keeps poll state outside public assets", () => {
    expect(EDITORIAL_STATE_PATH).not.toContain("/public/");
    expect(EDITORIAL_STATE_PATH.endsWith("/data/editorial/poll-state.json")).toBe(true);
  });

  it("backs off 24 hours after 403 or 429", () => {
    expect(EDITORIAL_BACKOFF_MS).toBe(24 * 60 * 60 * 1000);
    expect(interpretEditorialResponse(403, 4)).toEqual({ status: "backoff" });
    expect(interpretEditorialResponse(429, 4)).toEqual({ status: "backoff" });
    expect(interpretEditorialResponse(200, 0)).toEqual({ status: "degraded" });
    expect(interpretEditorialResponse(200, 3)).toEqual({ status: "ready" });
    expect(interpretEditorialResponse(304, 0)).toEqual({ status: "not-modified" });
  });

  it("skips a feed still inside its cadence or backoff window", () => {
    expect(
      feedIsDue(ONE_FEED[0], { lastFetchedAt: NOW - 60 * 60 * 1000 }, NOW),
    ).toBe(false);
    expect(
      feedIsDue(
        ONE_FEED[0],
        { backoffUntil: NOW + 60 * 1000 },
        NOW,
      ),
    ).toBe(false);
    expect(feedIsDue(ONE_FEED[0], {}, NOW)).toBe(true);
    expect(
      feedIsDue(ONE_FEED[0], { lastFetchedAt: NOW - 60 * 60 * 1000 }, NOW, {
        force: true,
      }),
    ).toBe(true);
  });

  it("uses current time when feedIsDue now is omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(
        feedIsDue(ONE_FEED[0], { backoffUntil: NOW + 60 * 1000 }),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("editorial poller: one request per feed per tick", () => {
  it("sends the named UA and If-Modified-Since, and never stores a body", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const snapshot = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: { version: 1, generatedAt: "2026-08-15T12:00:00.000Z", status: "ready", items: [] },
      state: {
        deserter: { lastModified: "Sat, 15 Aug 2026 12:00:00 GMT" },
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({ url, headers });
        return new Response(rssItem("Pubcast 12", "https://deserter.co.uk/pubcast-12"), {
          status: 200,
          headers: { "Last-Modified": "Sat, 16 Aug 2026 09:00:00 GMT" },
        });
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("user-agent")).toBe(EDITORIAL_USER_AGENT);
    expect(calls[0]?.headers.get("if-modified-since")).toBe("Sat, 15 Aug 2026 12:00:00 GMT");
    expect(snapshot.status).toBe("ready");
    expect(snapshot.items).toHaveLength(1);
    expect(JSON.stringify(snapshot.items)).not.toMatch(/FULL BODY/);
    expect(Object.keys(snapshot.items[0]!).sort()).toEqual([
      "attribution_label",
      "canonical_url",
      "excerpt",
      "published_at",
      "source_id",
      "title",
    ]);
  });

  it("marks a 200 with zero items degraded and keeps earlier rows", async () => {
    const previousItem = {
      source_id: "deserter",
      title: "Held over",
      canonical_url: "https://deserter.co.uk/held",
      published_at: "2026-08-14T09:00:00.000Z",
      excerpt: "Still here.",
      attribution_label: "Deserter",
    };
    const snapshot = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: {
        version: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        status: "ready",
        items: [previousItem],
      },
      state: {},
      fetchImpl: async () =>
        new Response(`<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`, {
          status: 200,
        }),
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.items).toEqual([previousItem]);
  });

  it("records a 24h backoff after 403 and does not retry in the same tick", async () => {
    let hits = 0;
    const { snapshot, state } = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: { version: 1, generatedAt: "2026-08-15T12:00:00.000Z", status: "ready", items: [] },
      state: {},
      fetchImpl: async () => {
        hits += 1;
        return new Response("no", { status: 403 });
      },
    }).then((snapshot) => ({ snapshot, state: snapshot.state }));
    expect(hits).toBe(1);
    expect(snapshot.status).toBe("degraded");
    expect(state.deserter?.backoffUntil).toBe(NOW + EDITORIAL_BACKOFF_MS);
  });

  it("keeps a malformed feed degraded and preserves its previous rows", async () => {
    const previousItem = {
      source_id: "deserter",
      title: "Held over",
      canonical_url: "https://deserter.co.uk/held",
      published_at: "2026-08-14T09:00:00.000Z",
      excerpt: "Still here.",
      attribution_label: "Deserter",
    };
    const snapshot = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: {
        version: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        status: "ready",
        items: [previousItem],
      },
      fetchImpl: async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Missing URL</title></item></channel></rss>`,
          { status: 200 },
        ),
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.items).toEqual([previousItem]);
  });

  it("retries failed feeds without waiting for their normal cadence", async () => {
    const snapshot = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: { version: 1, generatedAt: "2026-08-15T12:00:00.000Z", status: "ready", items: [] },
      state: { deserter: { lastFetchedAt: NOW - 60 * 60 * 1000 } },
      force: true,
      fetchImpl: async () => new Response("upstream failed", { status: 500 }),
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.state.deserter?.lastFetchedAt).toBeUndefined();
    expect(
      feedIsDue(ONE_FEED[0], snapshot.state.deserter, NOW + 60 * 60 * 1000),
    ).toBe(true);
  });

  it("continues after a response-body failure and keeps a previous degraded status on idle", async () => {
    const secondFeed = {
      ...ONE_FEED[0],
      id: "enjoying-pubs",
      name: "Enjoying pubs",
      url: "https://enjoyingpubs.substack.com/feed",
    };
    let secondHit = false;
    const snapshot = await pollEditorialFeeds({
      now: NOW,
      feeds: [ONE_FEED[0], secondFeed],
      previous: { version: 1, generatedAt: "2026-08-15T12:00:00.000Z", status: "degraded", items: [] },
      fetchImpl: async (input) => {
        if (String(input).includes("deserter")) {
          const response = new Response("broken", { status: 200 });
          vi.spyOn(response, "text").mockRejectedValue(new Error("body failed"));
          return response;
        }
        secondHit = true;
        return new Response(rssItem("Second feed", "https://enjoyingpubs.substack.com/second"), {
          status: 200,
        });
      },
    });
    expect(secondHit).toBe(true);
    expect(snapshot.status).toBe("degraded");

    const idle = await pollEditorialFeeds({
      now: NOW,
      feeds: ONE_FEED,
      previous: snapshot,
      state: snapshot.state,
      fetchImpl: async () => {
        throw new Error("should not fetch while not due");
      },
    });
    expect(idle.status).toBe("degraded");
  });
});
