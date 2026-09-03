import { describe, expect, it, vi } from "vitest";

import {
  buildNearPriceTrustUrl,
  startNearPriceTrustRequest,
} from "@/components/nearme/useNearPriceTrust";
import type { NearMeCard } from "@/lib/nearMeAnswer";

function card(id: string, price: number): NearMeCard {
  return {
    id,
    name: id,
    borough: "Westminster",
    cheapestPrice: price,
  };
}

describe("near price trust client request", () => {
  it("asks only for the five cards in the current bounded answer", () => {
    expect(buildNearPriceTrustUrl([
      card("venue-a", 3.5),
      card("venue-b", 4),
      card("venue-c", 4.5),
      card("venue-d", 5),
      card("venue-e", 5.5),
      card("venue-f", 6),
    ])).toBe(
      "/api/near-price-trust?venueId=venue-a&venueId=venue-b&venueId=venue-c&venueId=venue-d&venueId=venue-e",
    );
  });

  it("deduplicates venue IDs without sending prices or location", () => {
    const url = buildNearPriceTrustUrl([
      card("venue-a", 3.5),
      card("venue-a", 9.99),
      card("venue-b", 4),
    ]);

    expect(url).toBe("/api/near-price-trust?venueId=venue-a&venueId=venue-b");
    expect(url).not.toContain("3.5");
    expect(url).not.toContain("9.99");
    expect(url).not.toMatch(/lat|lng|borough/i);
  });

  it("does not make an empty trust request", () => {
    expect(buildNearPriceTrustUrl([])).toBeNull();
  });

  it("passes an abort signal and cancels an in-flight request", async () => {
    let rejectFetch: ((reason: unknown) => void) | undefined;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const request = startNearPriceTrustRequest("/api/near-price-trust?venueId=venue-a", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/near-price-trust?venueId=venue-a",
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );

    request.abort();

    expect(request.signal.aborted).toBe(true);
    await expect(request.promise).rejects.toMatchObject({ name: "AbortError" });
    rejectFetch?.(new Error("must not matter after abort"));
  });

  it("rejects a response that contains publisher data outside the display contract", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ready",
          collectedAt: "2026-07-03",
          results: [{ venueId: "venue-a", price: 4.5, publisher: "Pint Prices", sourceUrl: "https://secret.example" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const request = startNearPriceTrustRequest("/api/near-price-trust?venueId=venue-a", fetcher);

    await expect(request.promise).rejects.toThrow("near price trust response invalid");
  });

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
        { status: 503 },
      ),
    );
    const request = startNearPriceTrustRequest(
      "/api/near-price-trust?venueId=venue-a",
      fetcher,
    );

    await expect(request.promise).rejects.toThrow("near price trust read failed");
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});
