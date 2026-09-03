import { afterEach, describe, expect, it, vi } from "vitest";

import { startRoundWithStops } from "@/lib/startRoundWithStops";
import type { RoundState } from "@/lib/rounds";

function mockRoundState(code: string): RoundState {
  return {
    round: {
      id: `round-${code}`,
      code,
      title: "Test plan",
      createdByHandle: "ken",
      createdAt: "2026-07-11T00:00:00.000Z",
      closedAt: null,
    },
    members: [{ handle: "ken", joinedAt: "2026-07-11T00:00:00.000Z" }],
    stops: [],
    spends: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startRoundWithStops", () => {
  it("creates a Round then sequentially POSTs addStop for each seed stop", async () => {
    const calls: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({
        url,
        body,
        authorization: new Headers(init?.headers).get("authorization"),
      });

      if (url === "/api/rounds") {
        return new Response(JSON.stringify(mockRoundState("ABCD23")), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/rounds/ABCD23")) {
        return new Response(JSON.stringify(mockRoundState("ABCD23")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const result = await startRoundWithStops({
      handle: "ken",
      title: "River walk",
      seedStops: [
        { id: "v1", name: "The Anchor" },
        { id: "v2", name: "The Crown" },
      ],
      identity: {
        kind: "account",
        auth: { userId: "user-ken", accessToken: "token-ken" },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, code: "ABCD23" });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      url: "/api/rounds",
      body: { handle: "ken", title: "River walk" },
      authorization: "Bearer token-ken",
    });
    expect(calls[1]).toEqual({
      url: "/api/rounds/ABCD23",
      body: {
        action: "addStop",
        handle: "ken",
        venueId: "v1",
        venueName: "The Anchor",
      },
      authorization: "Bearer token-ken",
    });
    expect(calls[2]).toEqual({
      url: "/api/rounds/ABCD23",
      body: {
        action: "addStop",
        handle: "ken",
        venueId: "v2",
        venueName: "The Crown",
      },
      authorization: "Bearer token-ken",
    });
    // Sequential: each call awaited before the next (order above is enough;
    // also assert fetch was not fire-and-forget parallel).
    expect(fetchImpl.mock.invocationCallOrder[0]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[1]!,
    );
    expect(fetchImpl.mock.invocationCallOrder[1]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[2]!,
    );
  });

  it("skips addStop when seedStops is empty", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(mockRoundState("ZXCV12")), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await startRoundWithStops({
      handle: "ken",
      seedStops: [],
      identity: { kind: "anonymous" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, code: "ZXCV12" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the API error when create fails", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Add a handle to start a Round." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await startRoundWithStops({
      handle: "",
      identity: { kind: "anonymous" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      error: "Add a handle to start a Round.",
    });
  });
});
