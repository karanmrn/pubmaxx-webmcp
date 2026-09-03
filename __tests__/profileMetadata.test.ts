import { beforeEach, describe, expect, it, vi } from "vitest";

// Route modules can run assertServerEnv() at import scope (the house pattern).
// On Vercel vitest reads as production without test-scoped Supabase vars, so the
// import would throw — mock it to a no-op, exactly like every sibling route test
// (see __tests__/opsFreeze.test.ts).
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const resolveHandle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identityHandleStore", () => ({
  identityHandleStore: () => ({ resolve: resolveHandle }),
}));

import { generateMetadata } from "@/app/u/[handle]/page";

describe("profile route metadata", () => {
  beforeEach(() => {
    resolveHandle.mockReset();
    resolveHandle.mockResolvedValue(null);
  });

  it("publishes canonical metadata for an explicitly live handle", async () => {
    resolveHandle.mockResolvedValue({
      profileId: "profile-1",
      requestedHandle: "sam",
      currentHandle: "sam",
      redirect: false,
      status: "live",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "Sam" }),
    });

    // normalizeHandle lowercases, so "Sam" → "sam".
    expect(metadata.title).toBe("@sam");
    expect(metadata.description).toBe(
      "@sam's pint passport on PUBMAXX. Their Pint Drops, saved venues, and the crawls they've walked.",
    );
    expect(metadata.alternates).toEqual({ canonical: "/u/sam" });
    expect(metadata.openGraph).toMatchObject({
      title: "@sam",
      url: "/u/sam",
      type: "profile",
    });
    // A public profile stays indexable (the OG image is supplied by the
    // file-convention opengraph-image.tsx, so no images are set here).
    expect(metadata.robots).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("images");
  });

  it("keeps an unresolved handle out of search without publishing a canonical", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "unknown_sam" }),
    });

    expect(metadata.title).toBe("@unknown_sam");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("canonicalises a retired durable handle to the current public handle", async () => {
    resolveHandle.mockResolvedValue({
      profileId: "profile-1",
      requestedHandle: "old_sam",
      currentHandle: "new_sam",
      redirect: true,
      status: "live",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "old_sam" }),
    });

    expect(metadata.title).toBe("@new_sam");
    expect(metadata.description).toContain("@new_sam's pint passport");
    expect(metadata.alternates).toEqual({ canonical: "/u/new_sam" });
    expect(metadata.openGraph).toMatchObject({
      title: "@new_sam",
      url: "/u/new_sam",
    });
  });

  it("fails closed for indexing when alias storage is unavailable", async () => {
    resolveHandle.mockRejectedValue(new Error("storage unavailable"));

    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "sam" }),
    });

    expect(metadata.title).toBe("@sam");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("does not expose a tombstoned profile's current handle through a retired alias", async () => {
    resolveHandle.mockResolvedValue({
      profileId: "profile-1",
      requestedHandle: "old_departed_sam",
      currentHandle: "private_departed_sam",
      redirect: true,
      status: "gone",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "old_departed_sam" }),
    });

    expect(metadata.title).toBe("@old_departed_sam");
    expect(metadata.description).toBe(
      "This account has left. The handle is still reserved, but there is no live profile here any more.",
    );
    expect(JSON.stringify(metadata)).not.toContain("private_departed_sam");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("keeps the per-viewer 'you' sentinel out of search", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "you" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it("keeps a missing/unusable handle out of search", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "@@@" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
