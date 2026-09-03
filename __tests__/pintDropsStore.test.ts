import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase admin so toDTO/deletePhotos exercise Storage without a live
// project. createSignedUrl returns deterministic test URLs.
const removeMock = vi.fn(async () => ({ data: [], error: null }));
const createSignedUrl = vi.fn(async (key: string) => ({
  data: { signedUrl: `https://cdn.test/signed/pint-drops/${key}` },
  error: null,
}));
const createSignedUrls = vi.fn(async (keys: string[]) => ({
  data: keys.map((path) => ({
    path,
    signedUrl: `https://cdn.test/signed/pint-drops/${path}`,
    error: null,
  })),
  error: null,
}));
const rpcMock = vi.fn();
const reviewRowsRef = { rows: [] as Record<string, unknown>[] };
// Table insert mock (create() → admin().from(TABLE).insert(row)). Each test sets
// its own resolved value(s); a from() call returns a fresh object every time so
// the two inserts of a resilience retry each hit the queued mock in order.
const insertMock = vi.fn();
const updateMock = vi.fn((values: Record<string, unknown>) => {
  void values;
  return {
    eq: vi.fn(() => ({
      select: vi.fn(async () => ({ data: [{ id: "x" }], error: null })),
    })),
  };
});
const selectChain = {
  eq: vi.fn(),
  not: vi.fn(),
  is: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(async () => ({ data: { status: "visible" }, error: null })),
  then: (
    resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: reviewRowsRef.rows, error: null }).then(resolve, reject),
};
selectChain.eq.mockReturnValue(selectChain);
selectChain.not.mockReturnValue(selectChain);
selectChain.is.mockReturnValue(selectChain);
selectChain.order.mockReturnValue(selectChain);
selectChain.limit.mockReturnValue(selectChain);
const mockAdmin = () => ({
  from: () => ({
    insert: insertMock,
    select: vi.fn(() => selectChain),
    update: updateMock,
  }),
  storage: { from: () => ({ createSignedUrl, createSignedUrls, remove: removeMock }) },
  rpc: rpcMock,
});
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => mockAdmin(),
  requireSupabaseAdmin: () => mockAdmin(),
  STORAGE_BUCKET: "pint-drops",
}));

import {
  validatePhoto,
  magicBytesOk,
  toDTO,
  toDTOWithPhotos,
  deletePhotos,
  pintDropReportCountFromRow,
  memoryPintDropStore,
  supabasePintDropStore,
  MAX_PUBLIC_DROPS,
} from "@/lib/pintDropsStore";
import type { PersistableDrop } from "@/lib/pintDropsStore";
import {
  addPintDrop,
  __resetPintDrops,
  REPORT_HIDE_THRESHOLD,
  type PintDropReportIdentity,
} from "@/lib/pintDrops";

function verifiedReportIdentity(actorHash: string): PintDropReportIdentity {
  return { kind: "verified_account", actorHash };
}

function anonymousReportIdentity(actorHash: string): PintDropReportIdentity {
  return { kind: "anonymous_ip", actorHash };
}

afterEach(() => {
  __resetPintDrops();
  reviewRowsRef.rows = [];
  vi.clearAllMocks();
});

// Pure validation only — no live Supabase. These run in the same node env as
// the rest of the suite (no keys required).
describe("validatePhoto", () => {
  it("accepts a valid jpeg under the size cap", () => {
    expect(validatePhoto("image/jpeg", 2 * 1024 * 1024)).toBeNull();
  });

  it("accepts png and webp", () => {
    expect(validatePhoto("image/png", 1000)).toBeNull();
    expect(validatePhoto("image/webp", 1000)).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validatePhoto("application/pdf", 1000)).toMatch(/JPEG, PNG, or WebP/);
  });

  it("rejects a file over 5MB", () => {
    expect(validatePhoto("image/jpeg", 5 * 1024 * 1024 + 1)).toMatch(/5MB/);
  });
});

// Content-sniff the real signature so a mislabelled/crafted file can't pass the
// MIME check. Pure over Uint8Array — no File needed.
describe("magicBytesOk", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("accepts real JPEG/PNG/WebP signatures", () => {
    expect(magicBytesOk(jpeg, "image/jpeg")).toBe(true);
    expect(magicBytesOk(png, "image/png")).toBe(true);
    expect(magicBytesOk(webp, "image/webp")).toBe(true);
  });

  it("rejects a signature that does not match the declared MIME", () => {
    // A PNG-signatured buffer claiming to be a JPEG.
    expect(magicBytesOk(png, "image/jpeg")).toBe(false);
    // RIFF header but not a WEBP container (audio/other RIFF).
    const riffNotWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(magicBytesOk(riffNotWebp, "image/webp")).toBe(false);
  });

  it("rejects a spoofed/garbage buffer and an unknown MIME", () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(magicBytesOk(junk, "image/jpeg")).toBe(false);
    expect(magicBytesOk(jpeg, "application/pdf")).toBe(false);
  });
});

function drop(overrides: Partial<PersistableDrop> = {}): PersistableDrop {
  return {
    id: "d1",
    venueId: "the-crown",
    handle: "ale",
    drink: "",
    priceGbp: 4.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toDTO", () => {
  it("uses the verified ledger count instead of the mixed legacy count", () => {
    expect(pintDropReportCountFromRow({ report_count: 9, verified_report_count: 1 })).toBe(1);
    expect(pintDropReportCountFromRow({ report_count: 1, verified_report_count: 0 })).toBe(0);
    expect(pintDropReportCountFromRow({ report_count: 2 })).toBe(2);
  });
  it("maps storage keys to signed URLs and never leaks the keys", async () => {
    const dto = await toDTOWithPhotos(
      drop({ pintPhotoKey: "the-crown/d1/pint.jpg", venuePhotoKey: "the-crown/d1/venue.png" }),
    );
    expect(dto.pintPhotoUrl).toBe("https://cdn.test/signed/pint-drops/the-crown/d1/pint.jpg");
    expect(dto.venuePhotoUrl).toBe("https://cdn.test/signed/pint-drops/the-crown/d1/venue.png");
    expect(dto).not.toHaveProperty("pintPhotoKey");
    expect(dto).not.toHaveProperty("venuePhotoKey");
  });

  it("emits null URLs when a drop has no photos", () => {
    const dto = toDTO(drop());
    expect(dto.pintPhotoUrl).toBeNull();
    expect(dto.venuePhotoUrl).toBeNull();
  });

  it("returns null URLs for a hidden drop even when keys exist", () => {
    const dto = toDTO(
      drop({ status: "hidden", pintPhotoKey: "the-crown/d1/pint.jpg", venuePhotoKey: "the-crown/d1/venue.png" }),
    );
    expect(dto.pintPhotoUrl).toBeNull();
    expect(dto.venuePhotoUrl).toBeNull();
  });

  // Report-count transparency (safe): a visible drop with reports exposes ONLY
  // the bare count — never reasons, reporter metadata, or moderator notes.
  it("exposes reportCount on a visible reported drop, but no reasons/metadata", () => {
    const dto = toDTO(
      drop({
        reportCount: 1,
        reportReason: "wrong price",
        reportedAt: "2026-01-02T00:00:00.000Z",
        moderatorNote: "reviewed, kept",
        moderatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(dto.reportCount).toBe(1);
    // The reporter trail and moderator metadata never leave the server.
    expect(dto).not.toHaveProperty("reportReason");
    expect(dto).not.toHaveProperty("reportedAt");
    expect(dto).not.toHaveProperty("moderatorNote");
    expect(dto).not.toHaveProperty("moderatedAt");
  });

  it("omits reportCount when a visible drop has zero reports", () => {
    expect(toDTO(drop())).not.toHaveProperty("reportCount");
    expect(toDTO(drop({ reportCount: 0 }))).not.toHaveProperty("reportCount");
  });

  it("never exposes reportCount on a hidden drop", () => {
    // A hidden drop is not publicly visible; leaking its count would confirm a
    // takedown. (Public reads never return hidden drops anyway.)
    expect(toDTO(drop({ status: "hidden", reportCount: 5 }))).not.toHaveProperty("reportCount");
  });

  // Vibe tags are public, safe content — the DTO surfaces them. Exposing them
  // must not open any moderation leak.
  it("exposes vibeTags on a drop that has them", () => {
    const dto = toDTO(drop({ vibeTags: ["cheap", "riverside"] }));
    expect(dto.vibeTags).toEqual(["cheap", "riverside"]);
  });

  it("omits vibeTags entirely on a drop without them (backward-compatible)", () => {
    expect(toDTO(drop())).not.toHaveProperty("vibeTags");
  });

  it("exposes vibeTags but still leaks no report/moderation metadata", () => {
    const dto = toDTO(
      drop({
        vibeTags: ["cheap"],
        reportCount: 1,
        reportReason: "wrong price",
        reportedAt: "2026-01-02T00:00:00.000Z",
        moderatorNote: "reviewed, kept",
        moderatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(dto.vibeTags).toEqual(["cheap"]);
    expect(dto.reportCount).toBe(1); // the one sanctioned transparency field
    expect(dto).not.toHaveProperty("reportReason");
    expect(dto).not.toHaveProperty("reportedAt");
    expect(dto).not.toHaveProperty("moderatorNote");
    expect(dto).not.toHaveProperty("moderatedAt");
  });
});

describe("moderator Pint Drop review queue", () => {
  it("caps the memory queue and orders it by report age", async () => {
    for (let index = 0; index <= MAX_PUBLIC_DROPS; index += 1) {
      addPintDrop(
        drop({
          id: `reported-${index}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, MAX_PUBLIC_DROPS - index)).toISOString(),
          reportedAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
        }),
      );
    }

    const queue = await memoryPintDropStore.listForReview("reported");

    expect(queue).toHaveLength(MAX_PUBLIC_DROPS);
    expect(queue[0]?.id).toBe(`reported-${MAX_PUBLIC_DROPS}`);
    expect(queue.at(-1)?.id).toBe("reported-1");
    expect(queue.map((row) => row.id)).not.toContain("reported-0");
  });

  it("bounds the durable queue while preserving reported-at ordering", async () => {
    reviewRowsRef.rows = [
      drop({ id: "fresh-report", createdAt: "2026-01-01T00:00:00.000Z", reportedAt: "2026-08-23T12:00:00.000Z" }),
      drop({ id: "old-report", createdAt: "2026-08-23T12:00:00.000Z", reportedAt: "2026-08-23T11:00:00.000Z" }),
    ].map((row) => ({
      id: row.id,
      venue_id: row.venueId,
      handle: row.handle,
      drink: row.drink,
      price_gbp: row.priceGbp,
      passed_down_note: row.passedDownNote,
      era: row.era,
      provenance: row.provenance,
      status: row.status,
      created_at: row.createdAt,
      reported_at: row.reportedAt,
      report_reason: null,
      report_count: 1,
      moderated_at: null,
      moderator_note: null,
    }));

    const queue = await supabasePintDropStore.listForReview("reported");

    expect(queue.map((row) => row.id)).toEqual(["fresh-report", "old-report"]);
    expect(selectChain.limit).toHaveBeenCalledWith(MAX_PUBLIC_DROPS);
    expect(selectChain.order).toHaveBeenNthCalledWith(1, "reported_at", {
      ascending: false,
      nullsFirst: false,
    });
    expect(selectChain.order).toHaveBeenNthCalledWith(2, "created_at", { ascending: false });
  });
});

describe("deletePhotos", () => {
  it("removes the given keys and skips empty ones", async () => {
    removeMock.mockClear();
    await deletePhotos(["the-crown/d1/pint.jpg", "the-crown/d1/venue.png"]);
    expect(removeMock).toHaveBeenCalledWith(["the-crown/d1/pint.jpg", "the-crown/d1/venue.png"]);
  });

  it("no-ops (no Storage call) when there is nothing to delete", async () => {
    removeMock.mockClear();
    await deletePhotos([]);
    expect(removeMock).not.toHaveBeenCalled();
  });
});

// Migration 0017: the atomic, per-actor-unique report_pint_drop_v2 RPC. The
// route maps a false return to a 404, so the unknown-id path is a real
// contract, not a detail.
describe("supabasePintDropStore.report (atomic RPC)", () => {
  it("passes the actor hash + server-side hide threshold (one report can't hide content) and returns true on success", async () => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: 1, error: null });
    const result = await supabasePintDropStore.report(
      "d1",
      "spam",
      verifiedReportIdentity("hash-1"),
    );
    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("report_pint_drop_v2", {
      p_id: "d1",
      p_actor_hash: "hash-1",
      p_reason: "spam",
      p_hide_threshold: REPORT_HIDE_THRESHOLD,
    });
  });

  it("returns false for an unknown id (null data → 404 upstream)", async () => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(
      await supabasePintDropStore.report(
        "nope",
        undefined,
        verifiedReportIdentity("hash-1"),
      ),
    ).toBe(false);
  });

  it("fails closed when the per-account RPC is unavailable", async () => {
    rpcMock.mockClear();
    updateMock.mockClear();
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "report_pint_drop_v2 unavailable" },
    });

    await expect(
      supabasePintDropStore.report(
        "d1",
        "spam",
        verifiedReportIdentity("hash-1"),
      ),
    ).rejects.toThrow("report_pint_drop_v2 unavailable");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("report_pint_drop_v2", expect.any(Object));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("records an anonymous report through the state-preserving RPC", async () => {
    rpcMock.mockClear();
    updateMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    expect(
      await supabasePintDropStore.report(
        "d1",
        "wrong price",
        anonymousReportIdentity("ip-hash"),
      ),
    ).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("report_pint_drop_anonymous", {
      p_id: "d1",
      p_actor_hash: "ip-hash",
      p_reason: "wrong price",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps an anonymous report for an unknown drop to false", async () => {
    rpcMock.mockClear();
    updateMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: false, error: null });

    expect(
      await supabasePintDropStore.report(
        "nope",
        "spam",
        anonymousReportIdentity("ip-hash"),
      ),
    ).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("report_pint_drop_anonymous", expect.any(Object));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// Additive-column rollout safety (migration 0005): create() must survive a live
// DB where the `vibe_tags` column isn't applied yet. Normal path includes the
// column; a missing-column error triggers ONE retry without it and still succeeds.
describe("supabasePintDropStore.create (vibe_tags rollout resilience)", () => {
  const noPhotos = { pint: null, venue: null };
  const dropWithTags = () =>
    drop({ id: "r1", vibeTags: ["cheap", "riverside"] }) as unknown as Parameters<
      typeof supabasePintDropStore.create
    >[0];

  it("normal path: first insert includes vibe_tags and does not retry", async () => {
    insertMock.mockReset();
    insertMock.mockResolvedValueOnce({ error: null });

    const dto = await supabasePintDropStore.create(dropWithTags(), noPhotos);

    expect(insertMock).toHaveBeenCalledTimes(1);
    // The single insert carries the vibe_tags column.
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.vibe_tags).toEqual(["cheap", "riverside"]);
    // The returned DTO still surfaces the tags (public content).
    expect(dto.vibeTags).toEqual(["cheap", "riverside"]);
  });

  it("missing authority column keeps the drop provisional until migration 0117 lands", async () => {
    insertMock.mockReset();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const verifiedDrop = drop({
      id: "verified-r1",
      authorityKey: "authority-a",
    }) as Parameters<typeof supabasePintDropStore.create>[0];
    insertMock
      .mockResolvedValueOnce({
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'authority_key' column of 'visit_reports' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null });

    const dto = await supabasePintDropStore.create(verifiedDrop, noPhotos);

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[0][0]).toHaveProperty(
      "authority_key",
      "authority-a",
    );
    expect(insertMock.mock.calls[1][0]).not.toHaveProperty("authority_key");
    expect(dto.authorityKey).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("migration 0117"),
      expect.any(String),
    );
    warn.mockRestore();
  });

  it("missing-column (42703): retries WITHOUT vibe_tags and still succeeds", async () => {
    insertMock.mockReset();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // First attempt fails with the Postgres undefined_column error naming the
    // column; the retry (row minus vibe_tags) succeeds.
    insertMock
      .mockResolvedValueOnce({
        error: { code: "42703", message: 'column "vibe_tags" of relation "visit_reports" does not exist' },
      })
      .mockResolvedValueOnce({ error: null });

    const dto = await supabasePintDropStore.create(dropWithTags(), noPhotos);

    expect(insertMock).toHaveBeenCalledTimes(2);
    // First insert had vibe_tags; the retry omitted the key entirely.
    expect((insertMock.mock.calls[0][0] as Record<string, unknown>).vibe_tags).toEqual([
      "cheap",
      "riverside",
    ]);
    expect(insertMock.mock.calls[1][0] as Record<string, unknown>).not.toHaveProperty("vibe_tags");
    // A one-line warning names the pending migration (not silent).
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("migration 0005"), expect.any(String));
    // The drop still persists; the DTO is returned normally.
    expect(dto.id).toBe("r1");
    warn.mockRestore();
  });

  it("missing-column (PostgREST PGRST204): also retries without vibe_tags", async () => {
    insertMock.mockReset();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insertMock
      .mockResolvedValueOnce({
        error: { code: "PGRST204", message: "Could not find the 'vibe_tags' column of 'visit_reports' in the schema cache" },
      })
      .mockResolvedValueOnce({ error: null });

    await supabasePintDropStore.create(dropWithTags(), noPhotos);

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[1][0] as Record<string, unknown>).not.toHaveProperty("vibe_tags");
    warn.mockRestore();
  });

  it("an unrelated insert error still throws (not swallowed as a missing column)", async () => {
    insertMock.mockReset();
    // A different missing column (not vibe_tags) must NOT be silently retried —
    // that would drop real data. The condition requires the vibe_tags name.
    insertMock.mockResolvedValueOnce({
      error: { code: "42703", message: 'column "handle" of relation "visit_reports" does not exist' },
    });

    await expect(supabasePintDropStore.create(dropWithTags(), noPhotos)).rejects.toThrow(
      /handle/,
    );
    expect(insertMock).toHaveBeenCalledTimes(1); // no retry
  });
});
