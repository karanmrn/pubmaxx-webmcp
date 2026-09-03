import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/social/page";

describe("/social generateMetadata indexing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps Social indexed by default", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "");
    const metadata = await generateMetadata();
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("indexes Social when the friends launch flag is on", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    const metadata = await generateMetadata();
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });
});
