// Editorial RSS poller. Manual / build step: writes
// public/data/editorial/latest.json. This repo cannot run serverless cron
// for ingest, so the rail reads that static file.
//
// One request per feed per tick. UA names PUBMAXXING. If-Modified-Since.
// 24h backoff on 403/429. A 200 with zero items is degraded, not empty.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EDITORIAL_BACKOFF_MS,
  EDITORIAL_FEEDS,
  EDITORIAL_FETCH_TIMEOUT_MS,
  EDITORIAL_USER_AGENT,
  dedupeEditorialItems,
  feedIsDue,
  interpretEditorialResponse,
  parseEditorialFeedXml,
  storedEditorialItem,
} from "../../lib/editorialRss.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EDITORIAL_LATEST_PATH = join(ROOT, "public", "data", "editorial", "latest.json");
export const EDITORIAL_STATE_PATH = join(ROOT, "data", "editorial", "poll-state.json");

function emptySnapshot() {
  return {
    version: 1,
    generatedAt: "",
    status: "ready",
    items: [],
  };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function releaseBody(response) {
  if (response.bodyUsed) return;
  void response.body?.cancel?.().catch(() => {});
}

export async function pollEditorialFeeds({
  now,
  feeds = EDITORIAL_FEEDS,
  previous = emptySnapshot(),
  state = {},
  fetchImpl = fetch,
  force = false,
} = {}) {
  const nextState = { ...(state ?? {}) };
  let items = [...(previous?.items ?? [])];
  let anyDegraded = previous?.status === "degraded";

  for (const feed of feeds) {
    const feedState = nextState[feed.id] ?? {};
    if (!feedIsDue(feed, feedState, now, { force })) continue;

    const headers = {
      "User-Agent": EDITORIAL_USER_AGENT,
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    };
    if (typeof feedState.lastModified === "string" && feedState.lastModified.length > 0) {
      headers["If-Modified-Since"] = feedState.lastModified;
    }

    let response;
    try {
      response = await fetchImpl(feed.url, {
        headers,
        signal: AbortSignal.timeout(EDITORIAL_FETCH_TIMEOUT_MS),
      });
    } catch {
      anyDegraded = true;
      nextState[feed.id] = { ...feedState, lastFetchedAt: undefined, backoffUntil: undefined };
      continue;
    }

    const lastModified = response.headers.get("Last-Modified") ?? feedState.lastModified;
    const http = interpretEditorialResponse(response.status, 1);

    if (http.status === "backoff") {
      anyDegraded = true;
      releaseBody(response);
      nextState[feed.id] = {
        ...feedState,
        lastFetchedAt: undefined,
        backoffUntil: now + EDITORIAL_BACKOFF_MS,
      };
      continue;
    }

    if (http.status === "not-modified") {
      releaseBody(response);
      nextState[feed.id] = { ...feedState, lastFetchedAt: now, lastModified };
      continue;
    }

    if (response.status !== 200) {
      anyDegraded = true;
      releaseBody(response);
      nextState[feed.id] = {
        ...feedState,
        lastFetchedAt: undefined,
        lastModified,
        backoffUntil: undefined,
      };
      continue;
    }

    let parsed;
    try {
      const xml = await response.text();
      parsed = parseEditorialFeedXml(xml, feed.id);
    } catch {
      anyDegraded = true;
      releaseBody(response);
      nextState[feed.id] = {
        ...feedState,
        lastFetchedAt: undefined,
        lastModified,
        backoffUntil: undefined,
      };
      continue;
    }
    const outcome = interpretEditorialResponse(200, parsed.items.length);
    nextState[feed.id] = {
      ...feedState,
      lastFetchedAt: now,
      lastModified,
      backoffUntil: undefined,
    };

    if (outcome.status !== "ready") {
      anyDegraded = true;
      continue;
    }

    if (parsed.items.length < parsed.itemCount) anyDegraded = true;

    const stored = parsed.items.map((item) => storedEditorialItem(item, feed.name));
    items = items.filter((item) => item.source_id !== feed.id).concat(stored);
  }

  const snapshot = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    status: anyDegraded ? "degraded" : "ready",
    items: dedupeEditorialItems(items),
    state: nextState,
  };
  return snapshot;
}

function writeLatest(snapshot) {
  const body = {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    status: snapshot.status,
    items: snapshot.items,
  };
  mkdirSync(dirname(EDITORIAL_LATEST_PATH), { recursive: true });
  mkdirSync(dirname(EDITORIAL_STATE_PATH), { recursive: true });
  writeFileSync(EDITORIAL_LATEST_PATH, `${JSON.stringify(body, null, 2)}\n`);
  writeFileSync(EDITORIAL_STATE_PATH, `${JSON.stringify(snapshot.state, null, 2)}\n`);
}

async function main() {
  const force = process.argv.includes("--all");
  const previous = readJson(EDITORIAL_LATEST_PATH, emptySnapshot());
  const state = readJson(EDITORIAL_STATE_PATH, {});
  const snapshot = await pollEditorialFeeds({
    now: Date.now(),
    previous,
    state,
    force,
  });
  writeLatest(snapshot);
  console.log(
    `${snapshot.status} editorial overlay: ${snapshot.items.length} items from ${EDITORIAL_FEEDS.length} feeds`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
