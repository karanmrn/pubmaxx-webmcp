import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

describe("Supabase migration versions", () => {
  it("keeps every timestamp version unique", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"));
    const versions = migrations.map((name) => name.split("_", 1)[0]);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });
});
