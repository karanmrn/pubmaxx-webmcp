import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsOnRefresh.server", () => ({
  refreshWhatsOnListings: vi.fn(),
}));

import { GET } from "@/app/api/cron/refresh-whats-on/route";
import { refreshWhatsOnListings } from "@/lib/whatsOnRefresh.server";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-whats-on", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.mocked(refreshWhatsOnListings).mockResolvedValue({
    ok: true,
    mode: "providers",
    written: 12,
    observedAt: "2026-08-24T05:30:00.000Z",
    providers: [{ name: "ticketmaster", configured: true, rows: 4 }],
    kinds: [
      { name: "quiz", kind: "quiz", rows: 2 },
      { name: "deal", kind: "deal", rows: 3 },
      { name: "music", kind: "music", rows: 2 },
      { name: "sport", kind: "sport", rows: 1 },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/refresh-whats-on", () => {
  it("401s without the cron secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("persists official-API rows without stamping the combined feed", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: "providers",
      written: 12,
      observedAt: "2026-08-24T05:30:00.000Z",
      stamped: false,
      kinds: expect.arrayContaining([
        expect.objectContaining({ kind: "quiz" }),
        expect.objectContaining({ kind: "deal" }),
        expect.objectContaining({ kind: "music" }),
        expect.objectContaining({ kind: "sport" }),
      ]),
    });
  });

  it("does not stamp when no provider is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(refreshWhatsOnListings).mockResolvedValueOnce({
      ok: false,
      mode: "no-providers",
      written: 0,
      observedAt: null,
      providers: [{ name: "ticketmaster", configured: false, rows: 0 }],
      kinds: [],
    });
    const res = await GET(req("Bearer test-secret"));
    expect(await res.json()).toMatchObject({
      ok: false,
      mode: "no-providers",
      stamped: false,
      observedAt: null,
    });
    warn.mockRestore();
  });

  it("does not stamp when the provider fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(refreshWhatsOnListings).mockResolvedValueOnce({
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: [{ name: "ticketmaster", configured: true, rows: 0, error: "500" }],
      kinds: [],
    });
    const res = await GET(req("Bearer test-secret"));
    expect(await res.json()).toMatchObject({ ok: false, stamped: false, observedAt: null });
    warn.mockRestore();
  });
});
