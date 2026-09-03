import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Night Profile RPC hardening migration", () => {
  it("moves Pal ownership validation behind a non-callable trigger", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20260717072119_night_profile_rpc_hardening.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("create trigger night_profiles_validate_pal");
    expect(sql).toContain("where id = new.pub_pal_id and owner_id = new.owner_id");
    expect(sql).toContain("revoke all on function public.validate_night_profile_pal()");
    expect(sql).toContain("drop function public.owns_night_profile_pal(uuid, uuid)");
    expect(sql).not.toContain("grant execute on function public.validate_night_profile_pal");
    expect(sql).toContain("plan_completions_qualifying_arrival_action_idx");
  });
});
