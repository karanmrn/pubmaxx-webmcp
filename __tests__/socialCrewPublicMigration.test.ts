import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FORWARD = readFileSync(
  join(ROOT, "supabase/migrations/20260823120000_0115_social_crew_public_preview.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "supabase/migrations/rollback/20260823120000_0115_social_crew_public_preview_rollback.sql"),
  "utf8",
);
const PUBLIC_PREVIEW_FUNCTION = FORWARD.split(
  "create or replace function public.list_open_social_crews(",
)[0];

describe("0115 public Open Crew preview migration", () => {
  it("ships a service-only open active preview RPC with no member or request joins", () => {
    expect(FORWARD).toMatch(/create or replace function public\.read_social_crew_public_preview\(/i);
    expect(FORWARD).toMatch(/returns jsonb/i);
    expect(FORWARD).toMatch(/security definer/i);
    expect(FORWARD).toMatch(/set search_path\s*=\s*''/i);
    expect(FORWARD).toMatch(/crew\.visibility\s*=\s*'open'/i);
    expect(FORWARD).toMatch(/plan\.status\s+in\s*\('draft','ready','active','ending'\)/i);
    expect(FORWARD).toMatch(/plan\.start_time\s*\+\s*interval\s+'8 hours'\s*>\s*statement_timestamp\(\)/i);
    expect(FORWARD).toMatch(/join lateral/i);
    expect(FORWARD).toMatch(/select plan_stop\.venue_id, plan_stop\.venue_name[\s\S]*?order by plan_stop\.position, plan_stop\.venue_id[\s\S]*?limit 1/i);
    expect(FORWARD).toMatch(/stop\.venue_id is not null and btrim\(stop\.venue_id\) <> ''/i);
    expect(FORWARD).toMatch(/create or replace function public\.list_open_social_crews\(/i);
    expect(FORWARD).toMatch(/plan\.start_time\s*\+\s*interval\s+'8 hours'\s*>\s*statement_timestamp\(\)/i);
    expect(FORWARD).toMatch(/revoke all on function public\.read_social_crew_public_preview\(uuid\)[\s\S]*?from public, anon, authenticated/i);
    expect(FORWARD).toMatch(/grant execute on function public\.read_social_crew_public_preview\(uuid\)[\s\S]*?to service_role/i);
    expect(PUBLIC_PREVIEW_FUNCTION).not.toMatch(/social_crew_members\s+member/i);
    expect(PUBLIC_PREVIEW_FUNCTION).not.toMatch(/join_requests/i);
  });

  it("ships a matching transactional rollback and removes the service RPC", () => {
    expect(ROLLBACK.trim().toLowerCase()).toMatch(/^begin;/);
    expect(ROLLBACK).toMatch(/drop function if exists public\.read_social_crew_public_preview\(uuid\)/i);
    expect(ROLLBACK).toMatch(/create or replace function public\.list_open_social_crews\(/i);
    expect(ROLLBACK).toMatch(/plan\.start_time\s*>=\s*p_from/i);
    expect(ROLLBACK.trim().toLowerCase()).toMatch(/commit;$/);
  });
});
