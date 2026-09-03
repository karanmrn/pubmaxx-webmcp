import { describe, expect, it, vi, beforeEach } from "vitest";

// Capture the TTL passed to Supabase's createSignedUrl so we can assert the
// public recap path signs with a SHORT lifetime (R2: signed URLs can't be
// revoked, so a withdrawn consent must not stay fetchable for an hour).
const createSignedUrl = vi.fn(async (key: string) => ({
  data: { signedUrl: `https://cdn.test/signed/${key}` },
  error: null,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
  isSupabaseConfigured: () => true,
  STORAGE_BUCKET: "pint-drops",
}));

import {
  NIGHT_MOMENT_PHOTO_TTL_SECONDS,
  PUBLIC_RECAP_PHOTO_TTL_SECONDS,
  signedNightMomentPhotoUrl,
} from "@/lib/nightMomentMedia";

describe("signedNightMomentPhotoUrl TTL", () => {
  beforeEach(() => createSignedUrl.mockClear());

  it("keeps the owner-facing default at one hour", () => {
    expect(NIGHT_MOMENT_PHOTO_TTL_SECONDS).toBe(3600);
  });

  it("signs owner surfaces with the long default when no TTL is passed", async () => {
    await signedNightMomentPhotoUrl("night-moments/o/m/x.jpg");
    expect(createSignedUrl).toHaveBeenCalledWith("night-moments/o/m/x.jpg", 3600);
  });

  it("exposes a short public-recap TTL well under the default", () => {
    expect(PUBLIC_RECAP_PHOTO_TTL_SECONDS).toBe(180);
    expect(PUBLIC_RECAP_PHOTO_TTL_SECONDS).toBeLessThan(NIGHT_MOMENT_PHOTO_TTL_SECONDS);
  });

  it("the public recap path requests the short TTL, bounding withdrawn-consent exposure", async () => {
    await signedNightMomentPhotoUrl("night-moments/o/m/x.jpg", PUBLIC_RECAP_PHOTO_TTL_SECONDS);
    expect(createSignedUrl).toHaveBeenCalledWith("night-moments/o/m/x.jpg", 180);
  });

  it("returns null for a missing key without signing", async () => {
    expect(await signedNightMomentPhotoUrl(null)).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
