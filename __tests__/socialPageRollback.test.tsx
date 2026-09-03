import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  rivalry: vi.fn(async () => [{ city: "London" }]),
  heritage: vi.fn(async () => [{ id: "crawl-1" }]),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/trustedHandoffFlags.server", () => ({
  readTrustedHandoffFlag: () => false,
}));

vi.mock("@/lib/cityRivalry", () => ({
  buildCityRivalrySnapshot: reads.rivalry,
}));

vi.mock("@/lib/heritageCrawls", () => ({
  loadHeritageCrawls: reads.heritage,
}));

vi.mock("@/app/social/SocialPageClient", () => ({
  default: ({ rivalry, heritageCrawls }: { rivalry: unknown[]; heritageCrawls: unknown[] }) =>
    createElement("output", null, JSON.stringify({ rivalry, heritageCrawls })),
}));

import SocialPage from "@/app/social/page";

describe("Social server rollback boundary", () => {
  it("does not load discover data when rollback is active", async () => {
    const element = await SocialPage({
      searchParams: Promise.resolve({ tab: "discover" }),
    });
    const html = renderToStaticMarkup(element);

    expect(reads.rivalry).not.toHaveBeenCalled();
    expect(reads.heritage).not.toHaveBeenCalled();
    expect(html).toContain("{&quot;rivalry&quot;:[],&quot;heritageCrawls&quot;:[]}");
  });
});
