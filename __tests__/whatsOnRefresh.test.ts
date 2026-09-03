import { describe, expect, it } from "vitest";

import {
  refreshOfficialWhatsOnListings,
  refreshWhatsOnListings,
} from "@/lib/whatsOnRefresh.server";
import type { WhatsOnListingStore } from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { OutLiveProvider } from "@/lib/out/loadOut";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import type { VenueRef } from "@/lib/venueIndex";

const NOW = Date.parse("2026-08-24T20:00:00.000Z");
const GENERATED = "2026-08-24T20:00:00.000Z";
const LEXINGTON: VenueRef = {
  id: "venue-1137z1c",
  name: "The Lexington",
  borough: "Islington",
  lat: 51.5326,
  lng: -0.1119,
};

function eventRow(id: string, sourceLabel = "Ticketmaster"): WhatsOnRow {
  return {
    id,
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: sourceLabel, url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: id,
  };
}

function quizRow(id: string): WhatsOnRow {
  return {
    id,
    placeName: "The Quiz Pub",
    kind: "quiz",
    startsAt: "2026-08-25T19:30:00.000Z",
    title: "Tuesday pub quiz",
    source: { label: "Question One", url: "https://questionone.com/venues/quiz-pub" },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
  };
}

function kindRow(kind: Exclude<WhatsOnRow["kind"], "event" | "quiz">): WhatsOnRow {
  return { ...quizRow(`${kind}-1`), kind, title: `${kind} listing` };
}

function memoryStore(): WhatsOnListingStore & { kinds: string[] } {
  const rows = new Map<string, WhatsOnRow[]>();
  return {
    kinds: [],
    async replaceKind(kind, next) {
      this.kinds.push(kind);
      rows.set(kind, next);
      return { written: next.length };
    },
    async readAll() {
      return { rows: [...rows.values()].flat(), generatedAt: GENERATED };
    },
  };
}

describe("refreshOfficialWhatsOnListings", () => {
  it("writes live event rows to the durable store", async () => {
    const store = memoryStore();
    let fetchContext: Parameters<NonNullable<OutLiveProvider["fetchTonight"]>>[0] | undefined;
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async (context) => {
          fetchContext = context;
          return [eventRow("tm-1")];
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: true, mode: "providers", written: 1 });
    expect(result.observedAt).toBeTruthy();
    expect(fetchContext?.cache).toBe("bypass");
    const snap = await store.readAll();
    expect(snap.rows.map((row) => row.id)).toEqual(["tm-1"]);
  });

  it("matches a canonical pub before the durable write", async () => {
    const store = memoryStore();
    const venueMatchIndex = buildOutVenueMatchIndex([LEXINGTON]);
    const row = {
      ...eventRow("tm-lexington"),
      placeName: LEXINGTON.name,
      lat: LEXINGTON.lat,
      lng: LEXINGTON.lng,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [row],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => venueMatchIndex,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        fetched: 1,
        dateValid: 1,
        matchStatus: "ready",
        matched: 1,
        unmatched: 0,
      }),
    ]);

    const snap = await store.readAll();
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].venueId).toBe(LEXINGTON.id);

    const pubOnly = await loadWhatsOn(
      { pubOnly: true, venueMatchIndex },
      {
        now: NOW,
        loadBaseline: () => snap.rows,
        fetchLive: async () => [],
      },
    );
    expect(pubOnly.rows.map((stored) => stored.id)).toEqual(["tm-lexington"]);
  });

  it("keeps previous matched rows when the venue index is unavailable", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => null,
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        matchStatus: "unavailable",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps previous matched rows when loading the venue index throws", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => {
        throw new Error("venue index unavailable");
      },
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        matchStatus: "unavailable",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps previous matched rows when the venue index is empty", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => buildOutVenueMatchIndex([]),
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({ matchStatus: "unavailable", matched: 0, unmatched: 1 }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps unmatched entertainment out of pub-only supply and reports the loss", async () => {
    const store = memoryStore();
    const venueMatchIndex = buildOutVenueMatchIndex([LEXINGTON]);
    const arena = {
      ...eventRow("tm-arena"),
      placeName: "The O2 Arena",
      lat: 51.503,
      lng: 0.0032,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [arena],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => venueMatchIndex,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({
        fetched: 1,
        dateValid: 1,
        cityValid: 1,
        matchStatus: "ready",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    const snap = await store.readAll();
    expect(snap.rows).toEqual([expect.objectContaining({ id: "tm-arena" })]);
    expect(snap.rows[0]).not.toHaveProperty("venueId");
    const pubOnly = await loadWhatsOn(
      { pubOnly: true, venueMatchIndex },
      { now: NOW, loadBaseline: () => snap.rows, fetchLive: async () => [] },
    );
    expect(pubOnly.rows).toEqual([]);
  });

  it("reports and drops provider rows outside Greater London", async () => {
    const store = memoryStore();
    const outsideLondon = {
      ...eventRow("tm-brighton"),
      placeName: "Brighton Dome",
      lat: 50.823,
      lng: -0.138,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [outsideLondon],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });

    expect(result.providers).toEqual([
      expect.objectContaining({ fetched: 1, dateValid: 1, cityValid: 0, rows: 0 }),
    ]);
    expect((await store.readAll()).rows).toEqual([]);
  });

  it("drops expired provider rows before they reach the store", async () => {
    const store = memoryStore();
    const expired = eventRow("old");
    expired.startsAt = "2026-08-22T19:00:00.000Z";
    expired.endsAt = "2026-08-22T22:00:00.000Z";
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [expired],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.written).toBe(0);
    expect(result.providers).toEqual([
      expect.objectContaining({ fetched: 1, dateValid: 0, cityValid: 0, rows: 0 }),
    ]);
    expect((await store.readAll()).rows).toEqual([]);
  });

  it("keeps the previous store when every configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Ticketmaster Discovery API returned 500");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(false);
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("keeps the previous store when one configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
      {
        name: "skiddle",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Skiddle unavailable");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("preserves rows from providers that are not configured", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("old-other", "Other Events")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new-ticketmaster")],
      },
      {
        name: "other-events",
        isConfigured: () => false,
        fetchTonight: async () => {
          throw new Error("must not fetch an unconfigured provider");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(true);
    expect((await store.readAll()).rows.map((row) => row.id).sort()).toEqual([
      "new-ticketmaster",
      "old-other",
    ]);
  });

  it("does not preserve fenced Skiddle rows", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("old-skiddle", "Skiddle")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new-ticketmaster")],
      },
      {
        name: "skiddle",
        isConfigured: () => false,
        fetchTonight: async () => [],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(true);
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["new-ticketmaster"]);
  });

  it("does not invent a refresh when no provider is configured", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      { name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [eventRow("x")] },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, mode: "no-providers", written: 0, observedAt: null });
  });

  it("persists non-event feed rows under their own durable kind", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      {
        name: "question one",
        isConfigured: () => true,
        fetchTonight: async () => [quizRow("quiz-1")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });

    expect(result).toMatchObject({ ok: true, written: 1 });
    expect(store.kinds).toEqual(["quiz"]);
    expect((await store.readAll()).rows).toEqual([quizRow("quiz-1")]);
  });

  it("reports rows committed before a later kind write fails", async () => {
    const store = memoryStore();
    const originalReplace = store.replaceKind.bind(store);
    store.replaceKind = async (kind, rows, generatedAt) => {
      if (kind === "quiz") throw new Error("quiz durable write failed");
      return originalReplace(kind, rows, generatedAt);
    };
    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "bounded-provider",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("event-1"), quizRow("quiz-1")],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      written: 1,
      observedAt: GENERATED,
    });
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["event-1"]);
  });

  it("refreshes quiz, deal, music, and sport feeds into the durable store", async () => {
    const store = memoryStore();
    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "ticketmaster",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("event-1")],
        },
      ],
      refreshers: {
        quiz: async () => [quizRow("quiz-1")],
        deal: async () => [kindRow("deal")],
        music: async () => [kindRow("music")],
        sport: async () => [kindRow("sport")],
      },
    });

    expect(result.ok).toBe(true);
    expect(store.kinds.sort()).toEqual(["deal", "event", "music", "quiz", "sport"]);
    expect((await store.readAll()).rows.map((row) => row.kind).sort()).toEqual([
      "deal",
      "event",
      "music",
      "quiz",
      "sport",
    ]);
  });

  it("forwards venue-index failure through the full refresh", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);

    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "ticketmaster",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("new")],
        },
      ],
      loadVenueMatchIndex: async () => null,
      refreshers: {
        quiz: async () => [],
        deal: async () => [],
        music: async () => [],
        sport: async () => [],
      },
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({ matchStatus: "unavailable", unmatched: 1 }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });
});
