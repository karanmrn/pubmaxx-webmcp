import { describe, expect, it } from "vitest";

import {
  loadServedWhatsOnListings,
  loadServedWhatsOnListingsWithFreshness,
} from "@/lib/whatsOnListings.server";
import type { WhatsOnListingStore } from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-24T20:00:00.000Z");

function row(over: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "event-1",
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: "tm-1",
    ...over,
  };
}

function storeReturning(rows: WhatsOnRow[]): WhatsOnListingStore {
  return {
    replaceKind: async () => ({ written: 0 }),
    readAll: async () => ({ rows, generatedAt: rows.length ? "2026-08-24T05:30:00.000Z" : null }),
  };
}

describe("loadServedWhatsOnListings", () => {
  it("prefers durable rows over the bundled fallback", async () => {
    const bundled = [row({ observedAt: "2026-08-22T04:38:00.000Z", title: "Bundled" })];
    const durable = [row({ observedAt: "2026-08-24T10:00:00.000Z", title: "Durable" })];
    const served = await loadServedWhatsOnListings({
      store: storeReturning(durable),
      bundled,
      now: NOW,
    });
    expect(served.map((item) => item.title)).toEqual(["Durable"]);
  });

  it("falls back to bundled rows when the store is empty", async () => {
    const bundled = [row({ id: "quiz-1", kind: "quiz", title: "Quiz" })];
    const served = await loadServedWhatsOnListings({
      store: storeReturning([]),
      bundled,
      now: NOW,
    });
    expect(served.map((item) => item.id)).toEqual(["quiz-1"]);
  });

  it("falls back to bundled rows when the durable read fails", async () => {
    const bundled = [row({ title: "Bundled" })];
    const failedStore: WhatsOnListingStore = {
      replaceKind: async () => ({ written: 0 }),
      readAll: async () => ({
        rows: [row({ title: "Unproven durable row" })],
        generatedAt: "2026-08-24T05:30:00.000Z",
        failed: true,
      }),
    };

    const served = await loadServedWhatsOnListings({
      store: failedStore,
      bundled,
      now: NOW,
    });

    expect(served.map((item) => item.title)).toEqual(["Bundled"]);
  });

  it("reports a failed durable read while returning bundled fallback", async () => {
    const failedStore: WhatsOnListingStore = {
      replaceKind: async () => ({ written: 0 }),
      readAll: async () => ({
        rows: [],
        generatedAt: null,
        failed: true,
      }),
    };

    const served = await loadServedWhatsOnListingsWithFreshness({
      store: failedStore,
      bundled: [row({ title: "Bundled" })],
      now: NOW,
    });

    expect(served.readStatus).toBe("degraded");
    expect(served.rows.map((item) => item.title)).toEqual(["Bundled"]);
  });

  it("never serves expired durable rows", async () => {
    const expired = row({
      id: "past",
      startsAt: "2026-08-22T19:00:00.000Z",
      endsAt: "2026-08-22T22:00:00.000Z",
    });
    const served = await loadServedWhatsOnListings({
      store: storeReturning([expired]),
      bundled: [],
      now: NOW,
    });
    expect(served).toEqual([]);
  });

  it("reports active durable rows as provider observations", async () => {
    const durable = row({ observedAt: "2026-08-24T19:00:00.000Z" });
    const served = await loadServedWhatsOnListingsWithFreshness({
      store: storeReturning([durable]),
      bundled: [],
      now: NOW,
    });
    expect(served.providerObservedAt).toBe("2026-08-24T19:00:00.000Z");
  });

  it("does not report a future durable event for the current tonight window", async () => {
    const future = row({
      startsAt: "2026-08-25T19:00:00.000Z",
      endsAt: "2026-08-25T22:00:00.000Z",
    });
    const served = await loadServedWhatsOnListingsWithFreshness({
      store: storeReturning([future]),
      bundled: [],
      now: NOW,
      window: "tonight",
    });
    expect(served.providerObservedAt).toBeNull();
  });
});
