import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import {
  __resetPlanMutationOutboxForTests,
  enqueueNightCrawlAction,
  flushPlanMutationOutbox,
  hasPendingPlanMutation,
  listPlanMutationOutbox,
  PLAN_MUTATION_OUTBOX_KEY,
} from "@/lib/planMutationOutbox";

const stop = { venueId: "venue-1", venueName: "The Bull", position: 0 };

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("planMutationOutbox", () => {
  beforeEach(() => {
    const listeners = new Map<string, Set<EventListener>>();
    (globalThis as { window?: unknown }).window = {
      localStorage: memoryStorage(),
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
      addEventListener: (name: string, listener: EventListener) => {
        const set = listeners.get(name) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(name, set);
      },
      removeEventListener: (name: string, listener: EventListener) => {
        listeners.get(name)?.delete(listener);
      },
    };
    __resetPlanMutationOutboxForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ stops: [stop], plan: {}, crew: [], actions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    __resetPlanMutationOutboxForTests();
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  it("enqueues with PLAN_HTTP_ONLY_SESSION and dedupes by scope", async () => {
    const first = await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const second = await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    expect(second.id).toBe(first.id);
    expect(listPlanMutationOutbox("plan-1")).toHaveLength(1);
    expect(first.body.memberToken).toBe(PLAN_HTTP_ONLY_SESSION);
    expect(first.previousCursor).toBe(0);
    expect(hasPendingPlanMutation("plan-1")).toBe(true);
    const raw = window.localStorage.getItem(PLAN_MUTATION_OUTBOX_KEY);
    expect(raw).toContain("plan-1");
  });

  it("flush confirms and removes the entry", async () => {
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("confirmed");
    expect(results[0]?.previousCursor).toBe(0);
    expect(listPlanMutationOutbox("plan-1")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(
      "/api/plans/plan-1/actions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "key-1" }),
      }),
    );
  });

  it("keeps pending entries on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "skipped",
      stop,
      idempotencyKey: "key-2",
      fingerprint: "fp-2",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("offline");
    expect(hasPendingPlanMutation("plan-1")).toBe(true);
  });

  it("marks 409 as conflict without deleting the row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 })),
    );
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-3",
      fingerprint: "fp-3",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("conflict");
    expect(listPlanMutationOutbox("plan-1")[0]?.status).toBe("conflict");
  });

  it("drains every plan while concurrent flushes share one run", async () => {
    const stopB = { venueId: "venue-2", venueName: "The Fox", position: 0 };
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    await enqueueNightCrawlAction({
      planId: "plan-a",
      type: "arrived",
      stop,
      idempotencyKey: "key-a",
      fingerprint: "fp-a",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    await enqueueNightCrawlAction({
      planId: "plan-b",
      type: "arrived",
      stop: stopB,
      idempotencyKey: "key-b",
      fingerprint: "fp-b",
      previousCursor: 0,
      optimisticCursor: 1,
    });

    const flushA = flushPlanMutationOutbox({ planId: "plan-a" });
    const flushB = flushPlanMutationOutbox({ planId: "plan-b" });
    await vi.waitFor(() => expect(resolvers.length).toBe(1));
    // Shared drain walks entries sequentially — unblock plan-a, then plan-b.
    resolvers[0]?.(
      new Response(JSON.stringify({ stops: [stop], plan: {}, crew: [], actions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    resolvers[1]?.(
      new Response(JSON.stringify({ stops: [stopB], plan: {}, crew: [], actions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const [aResults, bResults] = await Promise.all([flushA, flushB]);
    expect(aResults).toHaveLength(1);
    expect(aResults[0]?.planId).toBe("plan-a");
    expect(bResults).toHaveLength(1);
    expect(bResults[0]?.planId).toBe("plan-b");
    expect(listPlanMutationOutbox()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
