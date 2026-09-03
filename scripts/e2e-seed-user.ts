#!/usr/bin/env tsx
/**
 * Seed the one local signed-in review identity.
 *
 * Exact local flow:
 *
 *   1. Ensure `.env` or `.env.local` contains the real Supabase URL,
 *      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only
 *      `SUPABASE_SERVICE_ROLE_KEY`.
 *   2. Run `PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run e2e:seed`.
 *   3. Run `PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run test:e2e -- --project=chromium-authenticated`.
 *   4. Open the local app in Chrome DevTools or Playwright. The credentials
 *      are in `.e2e/qa-credentials.json`; never paste them into source or logs.
 *   5. Run `PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run e2e:teardown`.
 *
 * The script uses only the service-role key from the environment. It never
 * prints that key or the generated password. Seed and teardown are refused
 * unless the explicit flag is on, and CI refuses remote production targets.
 */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  E2E_QA_DISPLAY_NAME,
  E2E_QA_EMAIL,
  E2E_QA_HANDLE,
  assertSeedEnvironment,
  assertSeedProfileSafety,
  buildQaProfileInsert,
} from "../lib/e2eSeedPolicy";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS_PATH = resolve(ROOT, ".e2e", "qa-credentials.json");
const PROFILE_COLUMNS =
  "id,handle,user_id,display_name,founding_member_number,avatar_object_key,avatar_generation,cover_object_key,cover_generation";

loadEnvConfig(ROOT);

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "pint-drops";

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type ProfileRow = Row & {
  id: string;
  handle: string;
  user_id: string | null;
  founding_member_number: number | null;
};

type QaCredentials = {
  version: 1;
  email: string;
  handle: string;
  password: string;
  userId: string;
};

type StorageEntry = {
  name: string;
  id: string | null;
};

function fail(message: string): never {
  throw new Error(message);
}

function assertRequest(operation: string, error: { message?: string } | null): void {
  if (error) {
    fail(`Supabase ${operation} failed.`);
  }
}

function targetUrlList(): string[] {
  return [
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SITE_URL ?? "",
  ].filter(Boolean);
}

function adminClient(): Admin {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assertSeedEnvironment(process.env, targetUrlList());
  if (!url || !serviceRoleKey) {
    fail("E2E seed requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function selectRows(
  admin: Admin,
  table: string,
  columns: string,
  filters: readonly [string, string][],
): Promise<Row[]> {
  let query = admin.from(table).select(columns);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { data, error } = await query;
  assertRequest(`reading ${table}`, error);
  return (data ?? []) as unknown as Row[];
}

async function selectRowsWithOr(
  admin: Admin,
  table: string,
  columns: string,
  expression: string,
): Promise<Row[]> {
  const { data, error } = await admin.from(table).select(columns).or(expression);
  assertRequest(`reading ${table}`, error);
  return (data ?? []) as unknown as Row[];
}

async function deleteRows(
  admin: Admin,
  table: string,
  filters: readonly [string, string][],
): Promise<void> {
  let query = admin.from(table).delete();
  for (const [column, value] of filters) query = query.eq(column, value);
  const { error } = await query;
  assertRequest(`deleting from ${table}`, error);
}

async function deleteRowsWithOr(
  admin: Admin,
  table: string,
  expression: string,
): Promise<void> {
  const { error } = await admin.from(table).delete().or(expression);
  assertRequest(`deleting from ${table}`, error);
}

async function foundingCount(admin: Admin): Promise<number> {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("founding_member_number", "is", null);
  assertRequest("counting founding members", error);
  if (typeof count !== "number") fail("Supabase returned no founding-member count.");
  return count;
}

async function listAuthUsers(admin: Admin, email: string): Promise<Row[]> {
  const matches: Row[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    assertRequest("listing Auth users", error);
    for (const user of data.users ?? []) {
      if (user.email?.toLowerCase() === email.toLowerCase()) matches.push(user as unknown as Row);
    }
    if (!data.users || data.users.length < 1000) break;
  }
  return matches;
}

async function findAuthUser(admin: Admin): Promise<Row | null> {
  const matches = await listAuthUsers(admin, E2E_QA_EMAIL);
  if (matches.length > 1) fail("More than one E2E QA Auth user has the dedicated email.");
  return matches[0] ?? null;
}

async function findQaProfiles(admin: Admin, userId: string | null): Promise<ProfileRow[]> {
  const byHandle = await selectRows(admin, "profiles", PROFILE_COLUMNS, [["handle", E2E_QA_HANDLE]]);
  const byUser = userId
    ? await selectRows(admin, "profiles", PROFILE_COLUMNS, [["user_id", userId]])
    : [];
  const profiles = new Map<string, ProfileRow>();
  for (const row of [...byHandle, ...byUser]) {
    const profile = row as ProfileRow;
    if (profile.user_id && profile.user_id !== userId) {
      fail("The dedicated E2E handle belongs to another Auth user.");
    }
    profiles.set(profile.id, profile);
  }
  return [...profiles.values()];
}

async function listStorageKeys(
  admin: Admin,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix, {
    limit: 1000,
  });
  assertRequest("listing storage objects", error);
  const keys: string[] = [];
  for (const entry of (data ?? []) as StorageEntry[]) {
    const key = `${prefix}/${entry.name}`;
    if (entry.id === null) keys.push(...(await listStorageKeys(admin, key)));
    else keys.push(key);
  }
  return keys;
}

async function removeStorageKeys(admin: Admin, keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100);
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(batch);
    assertRequest("removing storage objects", error);
  }
}

function stringValue(row: Row, key: string): string | null {
  return typeof row[key] === "string" && row[key] ? String(row[key]) : null;
}

function profileActor(profileId: string): string {
  return `profile:${profileId}`;
}

async function cleanupQaData(
  admin: Admin,
  userId: string | null,
  profiles: readonly ProfileRow[],
): Promise<void> {
  const profileIds = profiles.map((profile) => profile.id);
  const storageKeys: string[] = [];

  for (const profile of profiles) {
    for (const prefix of [`avatars/${profile.id}`, `covers/${profile.id}`]) {
      storageKeys.push(...(await listStorageKeys(admin, prefix)));
    }
    for (const key of [
      stringValue(profile, "avatar_object_key"),
      stringValue(profile, "cover_object_key"),
    ]) {
      if (key) storageKeys.push(key);
    }
  }

  const drops = await selectRows(admin, "visit_reports", "id,pint_photo_key,venue_photo_key", [["handle", E2E_QA_HANDLE]]);
  for (const drop of drops) {
    for (const key of [stringValue(drop, "pint_photo_key"), stringValue(drop, "venue_photo_key")]) {
      if (key) storageKeys.push(key);
    }
  }

  const venuePhotos = profileIds.length
    ? await selectRows(admin, "venue_photos", "id,object_key", [["author_profile_id", profileIds[0]]])
    : [];
  if (profileIds.length > 1) {
    for (const profileId of profileIds.slice(1)) {
      venuePhotos.push(...(await selectRows(admin, "venue_photos", "id,object_key", [["author_profile_id", profileId]])));
    }
  }
  for (const photo of venuePhotos) {
    const key = stringValue(photo, "object_key");
    if (key) storageKeys.push(key);
  }

  const coverPhotos: Row[] = [];
  for (const profileId of profileIds) {
    coverPhotos.push(...(await selectRows(admin, "profile_cover_photos", "id,object_key", [["profile_id", profileId]])));
  }
  for (const cover of coverPhotos) {
    const key = stringValue(cover, "object_key");
    if (key) storageKeys.push(key);
  }

  const socialMedia: Row[] = [];
  const socialUploads: Row[] = [];
  for (const profileId of profileIds) {
    socialMedia.push(...(await selectRows(admin, "social_post_media", "id,object_key", [["owner_profile_id", profileId]])));
    socialUploads.push(...(await selectRows(admin, "social_post_media_uploads", "media_id,object_key", [["owner_profile_id", profileId]])));
  }
  for (const media of [...socialMedia, ...socialUploads]) {
    const key = stringValue(media, "object_key");
    if (key) storageKeys.push(key);
  }

  const conversations = await selectRowsWithOr(
    admin,
    "conversations",
    "id",
    `handle_a.eq.${E2E_QA_HANDLE},handle_b.eq.${E2E_QA_HANDLE}`,
  );
  const conversationIds = conversations.map((row) => String(row.id));
  const messages: Row[] = [];
  for (const conversationId of conversationIds) {
    messages.push(...(await selectRows(admin, "messages", "id,conversation_id,attachment_object_key", [["conversation_id", conversationId]])));
  }
  for (const message of messages) {
    const key = stringValue(message, "attachment_object_key");
    if (key) storageKeys.push(key);
  }

  const moments: Row[] = [];
  if (userId) {
    moments.push(...(await selectRows(admin, "night_moments", "id,media_object_key", [["owner_id", userId]])));
  }
  for (const moment of moments) {
    const key = stringValue(moment, "media_object_key");
    if (key) storageKeys.push(key);
  }

  await removeStorageKeys(admin, storageKeys);

  await deleteRows(admin, "visit_reports", [["handle", E2E_QA_HANDLE]]);
  await deleteRows(admin, "structured_visit_reports", [["handle", E2E_QA_HANDLE]]);
  await deleteRows(admin, "check_ins", [["handle", E2E_QA_HANDLE]]);
  await deleteRows(admin, "pub_presence", [["handle", E2E_QA_HANDLE]]);
  await deleteRowsWithOr(admin, "notifications", `recipient_handle.eq.${E2E_QA_HANDLE},actor_handle.eq.${E2E_QA_HANDLE}`);
  await deleteRows(admin, "crawl_stories", [["author_handle", E2E_QA_HANDLE]]);
  await deleteRowsWithOr(admin, "rounds", `created_by_handle.eq.${E2E_QA_HANDLE}`);
  await deleteRowsWithOr(admin, "round_members", `handle.eq.${E2E_QA_HANDLE}`);
  await deleteRowsWithOr(admin, "round_spends", `payer_handle.eq.${E2E_QA_HANDLE},recorded_by_handle.eq.${E2E_QA_HANDLE}`);
  await deleteRows(admin, "community_prices", [["contributor_handle", E2E_QA_HANDLE]]);
  for (const profileId of profileIds) {
    await deleteRows(admin, "community_prices", [["actor", profileActor(profileId)]]);
  }

  if (conversationIds.length > 0) {
    await admin.from("messages").delete().in("conversation_id", conversationIds).then(({ error }) => assertRequest("deleting messages", error));
    await admin.from("conversations").delete().in("id", conversationIds).then(({ error }) => assertRequest("deleting conversations", error));
  }

  if (userId) {
    for (const [table, column] of [
      ["adult_self_assertions", "user_id"],
      ["private_account_identities", "user_id"],
      ["private_social_accounts", "supabase_user_id"],
      ["night_profiles", "owner_id"],
      ["night_memories", "owner_id"],
      ["pub_pals", "owner_id"],
      ["pub_pal_voice_usage", "owner_id"],
      ["push_tokens", "user_id"],
      ["plans", "owner_user_id"],
      ["plan_crew_members", "user_id"],
      ["social_oauth_states", "owner_id"],
      ["external_social_accounts", "owner_id"],
    ] as const) {
      await deleteRows(admin, table, [[column, userId]]);
    }
    const { error: referralError } = await admin.rpc("erase_referral_account", {
      p_user_id: userId,
    });
    assertRequest("erasing referral data", referralError);
    await deleteRows(admin, "pending_plan_recaps", [["owner_id", userId]]);
  }

  for (const profileId of profileIds) {
    await deleteRowsWithOr(admin, "follows", `follower_id.eq.${profileId},followee_id.eq.${profileId}`);
    await deleteRowsWithOr(admin, "saved_list_follows", `follower_profile_id.eq.${profileId},list_owner_profile_id.eq.${profileId}`);
    await deleteRows(admin, "wanteds", [["owner_actor", profileActor(profileId)]]);
    await deleteRows(admin, "step_out_nudge_prefs", [["owner_actor", profileActor(profileId)]]);
    await deleteRows(admin, "saved_pubs", [["profile_id", profileId]]);
    await deleteRows(admin, "saved_lists", [["profile_id", profileId]]);
    await deleteRows(admin, "profile_handle_aliases", [["profile_id", profileId]]);
    await deleteRows(admin, "private_social_accounts", [["profile_id", profileId]]);
    await deleteRows(admin, "venue_photos", [["author_profile_id", profileId]]);
    await deleteRows(admin, "profile_cover_photos", [["profile_id", profileId]]);
    await deleteRows(admin, "social_posts", [["author_profile_id", profileId]]);
    await deleteRows(admin, "social_post_media_uploads", [["owner_profile_id", profileId]]);
    const mediaIds = socialMedia
      .filter((row) => stringValue(row, "id"))
      .map((row) => String(row.id));
    if (mediaIds.length > 0) {
      await admin.from("social_post_media_lifecycle_events").delete().in("media_id", mediaIds).then(({ error }) => assertRequest("deleting media lifecycle events", error));
    }
    await deleteRows(admin, "social_post_media", [["owner_profile_id", profileId]]);
    await deleteRows(admin, "profiles", [["id", profileId]]);
  }

}

async function writeCredentials(credentials: QaCredentials): Promise<void> {
  await mkdir(resolve(ROOT, ".e2e"), { recursive: true, mode: 0o700 });
  await writeFile(CREDENTIALS_PATH, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(CREDENTIALS_PATH, 0o600);
}

async function removeCredentials(): Promise<void> {
  await rm(CREDENTIALS_PATH, { force: true });
}

async function seed(admin: Admin): Promise<void> {
  const before = await foundingCount(admin);
  const existingUser = await findAuthUser(admin);
  const existingUserId = existingUser ? String(existingUser.id) : null;
  const profiles = await findQaProfiles(admin, existingUserId);
  for (const profile of profiles) {
    if (profile.founding_member_number !== null) {
      fail("The dedicated E2E profile already has a founding-member number; refusing to alter it.");
    }
  }
  await cleanupQaData(admin, existingUserId, profiles);

  const password = randomBytes(32).toString("base64url");
  let userId: string;
  if (existingUserId) {
    const { error } = await admin.auth.admin.updateUserById(existingUserId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: E2E_QA_DISPLAY_NAME, name: E2E_QA_DISPLAY_NAME },
    });
    assertRequest("resetting the E2E QA password", error);
    userId = existingUserId;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: E2E_QA_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: E2E_QA_DISPLAY_NAME, name: E2E_QA_DISPLAY_NAME },
    });
    assertRequest("creating the E2E QA user", error);
    if (!data.user?.id) fail("Supabase created no E2E QA user.");
    userId = data.user.id;
  }

  const { data: profileData, error: profileError } = await admin
    .from("profiles")
    .insert(buildQaProfileInsert(userId))
    .select(PROFILE_COLUMNS)
    .single();
  assertRequest("creating the E2E QA profile", profileError);
  if (!profileData) fail("Supabase returned no E2E QA profile.");
  if (profileData.display_name !== E2E_QA_DISPLAY_NAME) {
    fail("The E2E QA profile does not have its required marked display name.");
  }

  const { error: aliasError } = await admin.from("profile_handle_aliases").insert({
    profile_id: String(profileData.id),
    handle: E2E_QA_HANDLE,
    is_current: true,
  });
  assertRequest("creating the E2E QA handle alias", aliasError);

  const after = await foundingCount(admin);
  assertSeedProfileSafety({
    foundingCountBefore: before,
    foundingCountAfter: after,
    profile: profileData as Row,
  });
  await writeCredentials({
    version: 1,
    email: E2E_QA_EMAIL,
    handle: E2E_QA_HANDLE,
    password,
    userId,
  });
  console.log("E2E QA account seeded. Credentials saved to .e2e/qa-credentials.json.");
}

async function teardown(admin: Admin): Promise<void> {
  const existingUser = await findAuthUser(admin);
  const userId = existingUser ? String(existingUser.id) : null;
  const profiles = await findQaProfiles(admin, userId);
  for (const profile of profiles) {
    if (profile.founding_member_number !== null) {
      fail("The dedicated E2E profile has a founding-member number; refusing teardown.");
    }
  }
  await cleanupQaData(admin, userId, profiles);
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    assertRequest("deleting the E2E QA user", error);
  }
  await removeCredentials();
  console.log("E2E QA account and credentials removed.");
}

async function main(): Promise<void> {
  const teardownMode = process.argv.slice(2).includes("--teardown");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--teardown" && arg !== "--help");
  if (process.argv.includes("--help")) {
    console.log("Use npm run e2e:seed or npm run e2e:teardown with PUBMAX_E2E_LOGIN=1.");
    return;
  }
  if (unknown.length > 0) fail("Unknown E2E seed argument.");
  const admin = adminClient();
  if (teardownMode) await teardown(admin);
  else await seed(admin);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unexpected error";
  console.error(`E2E seed failed: ${message}`);
  process.exitCode = 1;
});
