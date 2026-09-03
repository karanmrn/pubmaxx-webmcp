import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("retired scheduled price retrieval", () => {
  it("keeps the no-op cron out of runtime and freshness contracts", () => {
    expect(existsSync(join(root, "app/api/cron/refresh-prices/route.ts"))).toBe(false);
    expect(existsSync(join(root, "lib/priceRefresh.server.ts"))).toBe(false);

    const vercel = readFileSync(join(root, "vercel.json"), "utf8");
    const registry = readFileSync(join(root, "data/freshness_registry.json"), "utf8");
    const overlay = readFileSync(join(root, "lib/freshnessStoreOverlay.ts"), "utf8");

    expect(vercel).not.toContain("/api/cron/refresh-prices");
    expect(registry).not.toContain('"id": "price_update_retrieval"');
    expect(overlay).not.toContain("PRICE_UPDATE_RETRIEVAL");
  });
});
