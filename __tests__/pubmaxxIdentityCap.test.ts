import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/handleNormalize");
});

describe("PUBMAXX handle cap seam", () => {
  it("uses canonical HANDLE_MAX when the shared policy changes", async () => {
    vi.resetModules();
    vi.doMock("@/lib/handleNormalize", () => ({
      HANDLE_MAX: 35,
      normalizeHandle: (raw: unknown) =>
        typeof raw === "string"
          ? raw.trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "").slice(0, 35)
          : "",
    }));

    const { assessPubmaxxHandle } = await import("@/lib/pubmaxxIdentity");

    const expandedHandle = "a".repeat(31);
    expect(assessPubmaxxHandle(expandedHandle)).toMatchObject({
      ok: true,
      handle: expandedHandle,
    });
  });
});
