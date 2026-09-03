import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { securityProxy } from "@/proxy";

const ROOT = process.cwd();
const ACTIVE_MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "uk_base", "manifest.json"), "utf8"),
) as { urlPrefix: string };

describe("UK base generation compatibility", () => {
  it("rewrites requests for the removed Llandudno generation to active shards", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_UK_BASE_GENERATION",
      ACTIVE_MANIFEST.urlPrefix.match(/packs\/([a-f0-9]{16})\//)?.[1] ?? "",
    );
    const request = new NextRequest(
      "https://pubmaxxing.com/data/uk_base/packs/e229e760f3e7a2fd/53.25_-4.00.json",
    );

    const response = securityProxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://pubmaxxing.com${ACTIVE_MANIFEST.urlPrefix}53.25_-4.00.json`,
    );
  });
});
