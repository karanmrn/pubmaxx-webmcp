import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FORWARD = join(
  process.cwd(),
  "supabase/migrations/20260830120000_0124_social_admin_revision_guard.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260830120000_0124_social_admin_revision_guard_rollback.sql",
);
const forward = existsSync(FORWARD) ? readFileSync(FORWARD, "utf8").toLowerCase() : "";
const rollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8").toLowerCase() : "";
const compact = (value: string) => value.replace(/\s+/g, " ");

describe("0124 Social admin revision guard migration", () => {
  it("adds and rolls back only the revision-bound overload", () => {
    expect(existsSync(FORWARD)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(compact(forward)).toContain(
      "create function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_expected_revision integer,p_action text)",
    );
    expect(compact(forward)).toContain(
      "create or replace function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_action text)",
    );
    expect(compact(rollback)).toContain(
      "drop function if exists public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)",
    );
    expect(compact(rollback)).not.toContain(
      "drop function if exists public.moderate_social_post_admin(uuid,uuid,uuid,text)",
    );
    expect(compact(rollback)).toContain("four-argument overload stays fail closed");
  });

  it("replaces the legacy overload with a non-mutating false result", () => {
    const legacy = compact(forward).match(
      /create or replace function public\.moderate_social_post_admin\(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_action text\).*?as \$\$(.*?)\$\$;/,
    )?.[1];
    expect(legacy).toBeDefined();
    expect(legacy).toContain("return false");
    expect(legacy).not.toMatch(/\b(update|delete|insert|truncate)\b/);
  });

  it("locks the post and refuses a different current revision", () => {
    const sql = compact(forward);
    expect(sql).toMatch(
      /select \* into v_post from public\.social_posts where id = p_post_id for update;/,
    );
    expect(sql).toContain("p_expected_revision is null");
    expect(sql).toContain("v_post.revision <> p_expected_revision");
    expect(sql).toContain("v_post.photo_media_id is distinct from p_media_id");
    expect(sql).toContain("v_post.status <> 'visible'");
    expect(sql).toContain("job.revision = v_post.revision");
    expect(sql).toContain("job.media_id is not distinct from p_media_id");
    expect(sql).toContain("job.state = 'done'");
  });

  it("keeps the new overload service-role only", () => {
    const sql = compact(forward);
    const signature = "public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)";
    expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
    expect(sql).toContain(`grant execute on function ${signature} to service_role`);
  });
});
