import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const rollbackDir = join(migrationsDir, "rollback");

function repairMigration(): string {
  const name = readdirSync(migrationsDir).find((entry) =>
    entry.endsWith("_0113_social_rpc_privilege_repair.sql"),
  );
  expect(name, "0113 Social RPC privilege repair migration").toBeDefined();
  return readFileSync(join(migrationsDir, name!), "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("0113 Social RPC privilege repair", () => {
  it("keeps privileged moderation and crew reads service-only", () => {
    const sql = repairMigration();

    for (const signature of [
      "public.claim_social_post_moderation_jobs(integer)",
      "public.read_social_crew_snapshot(uuid, uuid, uuid)",
    ]) {
      expect(sql).toContain(
        `revoke all on function ${signature} from public, anon, authenticated`,
      );
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });

  it("ships an explicit manual rollback for the ACL change", () => {
    const name = readdirSync(rollbackDir).find((entry) =>
      entry.endsWith("_0113_social_rpc_privilege_repair_rollback.sql"),
    );
    expect(name, "0113 Social RPC privilege repair rollback").toBeDefined();
    const sql = readFileSync(join(rollbackDir, name!), "utf8")
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    for (const signature of [
      "public.claim_social_post_moderation_jobs(integer)",
      "public.read_social_crew_snapshot(uuid, uuid, uuid)",
    ]) {
      expect(sql).toContain(
        `grant execute on function ${signature} to public, anon, authenticated`,
      );
    }
  });
});
