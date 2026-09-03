import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260722123000_0050_api_only_social_reads.sql",
  ),
  "utf8",
);

const NORMALIZED_SQL = SQL.replace(/\s+/g, " ").trim().toLowerCase();

const API_ONLY_TABLES = [
  "public.profiles",
  "public.pint_drop_reactions",
  "public.pint_drop_comments",
  "public.crawl_story_stops",
] as const;

const UNSAFE_READ_POLICIES = [
  ["profiles_public_read", "public.profiles"],
  ["pint_drop_reactions_public_read", "public.pint_drop_reactions"],
  ["pint_drop_comments_public_read", "public.pint_drop_comments"],
  ["crawl_story_stops_public_read", "public.crawl_story_stops"],
] as const;

describe("API-only social reads migration", () => {
  it("removes every raw public-read policy without replacing it", () => {
    for (const [policy, table] of UNSAFE_READ_POLICIES) {
      expect(NORMALIZED_SQL).toContain(
        `drop policy if exists ${policy} on ${table};`,
      );
      expect(NORMALIZED_SQL).not.toContain(`create policy ${policy}`);
    }

    expect(NORMALIZED_SQL).not.toMatch(/\bcreate\s+policy\b/);
  });

  it("revokes direct SELECT from every client role on every sensitive table", () => {
    const tables = API_ONLY_TABLES.join(", ");

    expect(NORMALIZED_SQL).toContain(
      `revoke select on table ${tables} from public, anon, authenticated;`,
    );
  });

  it("preserves the service-role read path used by visibility-filtering APIs", () => {
    const tables = API_ONLY_TABLES.join(", ");

    expect(NORMALIZED_SQL).toContain(
      `grant select on table ${tables} to service_role;`,
    );
  });

  it("does not weaken RLS or disturb client write grants", () => {
    expect(NORMALIZED_SQL).not.toMatch(/\bdisable\s+row\s+level\s+security\b/);
    expect(NORMALIZED_SQL).not.toMatch(
      /grant\s+select[\s\S]*\bto\s+(public|anon|authenticated)\b/,
    );
    expect(NORMALIZED_SQL).not.toMatch(
      /revoke\s+(all|insert|update|delete)[\s\S]*\bfrom\s+(public|anon|authenticated)\b/,
    );
  });
});
