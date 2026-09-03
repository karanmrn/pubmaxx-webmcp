import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("night_profiles migration", () => {
  it("keeps rows account-owned under RLS and stores only a Pal foreign key", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20260717065003_0037_night_profiles.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("owner_id uuid primary key references auth.users(id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("auth.uid()) = owner_id");
    expect(sql).toContain("pub_pal_id uuid references public.pub_pals(id)");
    expect(sql).toContain("auth.uid()) = p_owner_id");
    expect(sql).toContain("owns_night_profile_pal(owner_id, pub_pal_id)");
    expect(sql).not.toMatch(/companion_name|pal_name|species/);
  });
});
