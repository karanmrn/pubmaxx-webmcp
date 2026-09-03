import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadReactionSummaries,
  readLocalReactions,
} from "@/lib/reactionClient";
import type { ReactionSummary } from "@/lib/reactions";

const IDS = Array.from({ length: 205 }, (_, index) => `drop-${index}`);

function requestedIds(input: RequestInfo | URL): string[] {
  const url = new URL(String(input), "http://localhost");
  return (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
}

function summary(id: string): ReactionSummary {
  return {
    counts: { cheers: Number(id.slice("drop-".length)) + 1 },
    mine: [],
  };
}

function jsonResponse(summaries: Record<string, ReactionSummary>, status = 200): Response {
  return new Response(JSON.stringify({ summaries }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileTimeline reaction summary batching", () => {
  it("migrates both legacy surface keys into the shared reaction store", () => {
    const values = new Map<string, string>([
      ["pubmax:feed:reactions:demo-drop", JSON.stringify(["cheers"])],
      ["pubmax:profile:reactions:demo-drop", JSON.stringify(["bargain"])],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    expect(readLocalReactions("demo-drop")).toEqual(["cheers", "bargain"]);
    expect(JSON.parse(values.get("pubmax:reactions:demo-drop") ?? "null")).toEqual([
      "cheers",
      "bargain",
    ]);
  });

  it("loads 205 ids in 100, 100, and 5-id GETs and merges every returned summary", async () => {
    const omittedId = "drop-42";
    const requests: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const ids = requestedIds(input);
        requests.push(ids);
        return jsonResponse(
          Object.fromEntries(
            ids.filter((id) => id !== omittedId).map((id) => [id, summary(id)]),
          ),
        );
      }),
    );

    const result = await loadReactionSummaries(IDS, "actor-1");

    expect(requests.map((ids) => ids.length)).toEqual([100, 100, 5]);
    expect(requests.every((ids) => new Set(ids).size === ids.length)).toBe(true);
    expect(new Set(requests.flat())).toEqual(new Set(IDS));
    expect(Object.keys(result.summaries)).toHaveLength(205);
    expect(result.summaries["drop-0"]).toEqual(summary("drop-0"));
    expect(result.summaries[omittedId]).toEqual({ counts: {}, mine: [] });
    expect(result.summaries["drop-204"]).toEqual(summary("drop-204"));
    expect(result.aborted).toBe(false);
  });

  it("keeps only ids from a failed batch retryable without marking them local-only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const ids = requestedIds(input);
        if (ids[0] === "drop-100") return jsonResponse({}, 503);
        return jsonResponse(Object.fromEntries(ids.map((id) => [id, summary(id)])));
      }),
    );

    const result = await loadReactionSummaries(IDS, "actor-1");

    expect(result.retryableIds).toEqual(new Set(IDS.slice(100, 200)));
    expect(result.summaries["drop-0"]).toEqual(summary("drop-0"));
    expect(result.summaries["drop-204"]).toEqual(summary("drop-204"));
    expect(result.summaries["drop-100"]).toEqual({ counts: {}, mine: [] });
  });

  it("does not mark any id local-only when cleanup aborts the requests", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      ),
    );

    const pending = loadReactionSummaries(IDS, "actor-1", controller.signal);
    controller.abort();
    const result = await pending;

    expect(result.aborted).toBe(true);
    expect(result.retryableIds).toEqual(new Set());
    expect(result.summaries).toEqual({});
  });
});
