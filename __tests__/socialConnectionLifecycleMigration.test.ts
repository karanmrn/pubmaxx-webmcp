import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260827100000_0120_social_connection_lifecycle.sql"),
  "utf8",
).toLowerCase();

describe("social connection lifecycle migration", () => {
  it("adds closed lifecycle fields", () => {
    expect(sql).toContain("refresh_status");
    expect(sql).toContain("consent_version");
    expect(sql).toContain("fetched_at");
    expect(sql).toContain("upstream_revocation_state");
    expect(sql).toMatch(/refresh_status[^;]+check/);
    expect(sql).toMatch(/upstream_revocation_state[^;]+check/);
    expect(sql).toMatch(/update public\.external_social_accounts[\s\S]+where mode = 'oauth'/);
    expect(sql).toMatch(/set refresh_status = 'refresh_due'[\s\S]+upstream_revocation_state = 'unknown'/);
  });

  it("keeps credential rows service-role only", () => {
    expect(sql).toContain(
      "revoke all on table public.external_social_accounts from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.external_social_accounts to service_role",
    );
    expect(sql).toContain("drop policy if exists external_social_accounts_owner_all");
    expect(sql).not.toMatch(/grant\s+[^;]+external_social_accounts\s+to\s+authenticated/);
  });
});
