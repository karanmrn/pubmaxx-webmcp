import { describe, expect, it, vi } from "vitest";

import {
  buildPriceEvidenceMissionUrl,
  dismissedVenueIds,
  parsePriceEvidenceMissionResponse,
  readPriceEvidenceMissionWithDeadline,
  startPriceEvidenceMissionRequest,
  type PriceEvidenceMissionRead,
  type PriceEvidenceMissionRequest,
} from "@/lib/priceEvidenceMissionClient";
import { MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS } from "@/lib/priceEvidenceMissions";

describe("buildPriceEvidenceMissionUrl", () => {
  it("asks only for bounded venue IDs", () => {
    expect(buildPriceEvidenceMissionUrl(["venue-a", "venue-b", "venue-a"]))
      .toBe("/api/price-missions?venueId=venue-a&venueId=venue-b");
  });

  it("sends no price, handle, or coordinates", () => {
    const url = buildPriceEvidenceMissionUrl(["venue-a"]);
    expect(url).not.toMatch(/handle|lat=|lng=|coord|priceGbp/i);
  });

  it("does not request an empty or over-bound list", () => {
    expect(buildPriceEvidenceMissionUrl([])).toBeNull();
    const tooMany = Array.from(
      { length: MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS + 1 },
      (_, index) => `venue-${index}`,
    );
    expect(buildPriceEvidenceMissionUrl(tooMany)).toBe(
      "/api/price-missions?" +
        tooMany.slice(0, MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS)
          .map((id) => `venueId=${id}`)
          .join("&"),
    );
  });
});

describe("parsePriceEvidenceMissionResponse", () => {
  it("accepts a ready DTO without a price or handle", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "provisional",
        drinkCategory: "beer",
        observedAt: 1,
      },
    })).toEqual({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "provisional",
        drinkCategory: "beer",
        observedAt: 1,
      },
    });
  });

  it("accepts a degraded empty read without turning it into an empty-market claim", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "degraded",
      mission: null,
    })).toEqual({ status: "degraded", mission: null });
  });

  it("rejects smuggled price, handle, or coordinate fields", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "missing",
        priceGbp: 4.2,
      },
    })).toBeNull();
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "missing",
        handle: "night_owl",
      },
    })).toBeNull();
  });
});

describe("dismissedVenueIds", () => {
  it("reads venue IDs from session dismiss keys", () => {
    expect(dismissedVenueIds(new Set(["venue-a\u0000provisional\u0000beer"])))
      .toEqual(new Set(["venue-a"]));
  });
});

describe("startPriceEvidenceMissionRequest", () => {
  it("cancels an unread error response body", async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("failure"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 401 },
      ),
    );
    const request = startPriceEvidenceMissionRequest(
      "/api/price-missions?venueId=venue-a",
      fetcher,
    );
    await expect(request.promise).rejects.toThrow("price evidence mission read failed");
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});

describe("readPriceEvidenceMissionWithDeadline", () => {
  function pending(): {
    request: PriceEvidenceMissionRequest;
    resolve: (read: PriceEvidenceMissionRead) => void;
    reject: (error: Error) => void;
    aborted: () => boolean;
  } {
    const controller = new AbortController();
    let resolve!: (read: PriceEvidenceMissionRead) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<PriceEvidenceMissionRead>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      request: {
        promise,
        signal: controller.signal,
        abort: () => controller.abort(),
      },
      resolve,
      reject,
      aborted: () => controller.signal.aborted,
    };
  }

  const READY: PriceEvidenceMissionRead = {
    status: "ready",
    mission: {
      venueId: "venue-a",
      reason: "provisional",
      drinkCategory: "wine",
    },
  };

  it("keeps a mission that landed before the deadline, and never fires after it", async () => {
    vi.useFakeTimers();
    try {
      const source = pending();
      const read = readPriceEvidenceMissionWithDeadline(source.request, 2000);

      vi.advanceTimersByTime(300);
      source.resolve(READY);
      await expect(read.settled).resolves.toEqual({ outcome: "read", read: READY });

      // The deadline is dropped the moment the read answers, so nothing is
      // left pending to reopen a settled question.
      expect(vi.getTimerCount()).toBe(0);

      // The regression: an uncleared 2 s timer used to overwrite the landed
      // mission with a degraded null two seconds after it painted.
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);
      await expect(read.settled).resolves.toEqual({ outcome: "read", read: READY });
      expect(source.aborted()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades a read that is still in flight at the deadline, and aborts it", async () => {
    vi.useFakeTimers();
    try {
      const source = pending();
      const read = readPriceEvidenceMissionWithDeadline(source.request, 2000);

      vi.advanceTimersByTime(1999);
      expect(source.aborted()).toBe(false);

      vi.advanceTimersByTime(1);
      await expect(read.settled).resolves.toEqual({ outcome: "degraded" });
      expect(source.aborted()).toBe(true);

      // A late answer after the deadline cannot re-settle the race.
      source.resolve(READY);
      await expect(read.settled).resolves.toEqual({ outcome: "degraded" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades a failed read once and stops the deadline", async () => {
    vi.useFakeTimers();
    try {
      const source = pending();
      const read = readPriceEvidenceMissionWithDeadline(source.request, 2000);

      source.reject(new Error("price evidence mission read failed"));
      await expect(read.settled).resolves.toEqual({ outcome: "degraded" });

      vi.advanceTimersByTime(5000);
      expect(source.aborted()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons on cancel and aborts the request in flight", async () => {
    vi.useFakeTimers();
    try {
      const source = pending();
      const read = readPriceEvidenceMissionWithDeadline(source.request, 2000);

      read.cancel();
      await expect(read.settled).resolves.toEqual({ outcome: "abandoned" });
      expect(source.aborted()).toBe(true);

      vi.advanceTimersByTime(5000);
      await expect(read.settled).resolves.toEqual({ outcome: "abandoned" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a landed answer alone when the caller cancels afterwards", async () => {
    vi.useFakeTimers();
    try {
      const source = pending();
      const read = readPriceEvidenceMissionWithDeadline(source.request, 2000);

      source.resolve(READY);
      await expect(read.settled).resolves.toEqual({ outcome: "read", read: READY });

      read.cancel();
      await expect(read.settled).resolves.toEqual({ outcome: "read", read: READY });
    } finally {
      vi.useRealTimers();
    }
  });
});
