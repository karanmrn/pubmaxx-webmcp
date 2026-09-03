// The database's half of the wall's promises.
//
// Three of the app's rules are only real if the schema says them too, because
// the service role is the write path and a bug in one store call would
// otherwise be a row nobody can explain: the object key belongs to this venue
// and this photo, the tag is on the app's closed taxonomy, and the actor is the
// author's own profile. The fourth is the tombstone: an account that leaves
// takes its wall photos and their bytes with it.
//
// This reads the SQL rather than a database, so it runs in the ordinary suite.
// The captain applies migrations; agents ship SQL only.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES } from "@/lib/drinks";
import { VENUE_PHOTO_CAPTION_MAX, venuePhotoServingKey } from "@/lib/venuePhotos";

const ROOT = process.cwd();
const FORWARD = readFileSync(
  join(ROOT, "supabase/migrations/20260809160000_0098_venue_photos.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "supabase/migrations/rollback/20260809160000_0098_venue_photos_rollback.sql"),
  "utf8",
);

describe("the wall's table", () => {
  it("is applied inside one transaction", () => {
    // The header comment explains the table; the SQL under it is atomic, so a
    // half-applied wall is not a state the captain can land in.
    expect(FORWARD).toMatch(/^begin;$/m);
    expect(FORWARD.trim().endsWith("commit;")).toBe(true);
  });

  it("pins the object key to this venue and this photo", () => {
    expect(FORWARD).toContain(
      "check (object_key = ('venue-photos/' || venue_id || '/' || id::text || '.jpg'))",
    );
    // The same string the app builds, so neither side restates a path.
    expect(venuePhotoServingKey("VENUE", "PHOTO")).toBe("venue-photos/VENUE/PHOTO.jpg");
  });

  it("repeats the app's closed drink taxonomy exactly", () => {
    const listed = FORWARD.match(
      /add constraint venue_photos_drink_category_check[\s\S]*?in \(([\s\S]*?)\)\s*\)/,
    )?.[1];
    expect(listed).toBeTruthy();
    const inSql = [...(listed ?? "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    // A new category needs a migration. That is the point of a closed set.
    expect([...inSql].sort()).toEqual([...DRINK_CATEGORIES].sort());
  });

  it("binds the stored actor to the author's own profile", () => {
    expect(FORWARD).toContain(
      "check (author_actor = ('profile:' || author_profile_id::text))",
    );
  });

  it("caps the caption at the same length the app does", () => {
    expect(FORWARD).toContain(`check (char_length(caption) <= ${VENUE_PHOTO_CAPTION_MAX})`);
  });

  it("indexes the wall read, the cap count and both moderator lanes", () => {
    expect(FORWARD).toContain("venue_photos_wall_idx");
    expect(FORWARD).toContain("venue_photos_author_venue_idx");
    expect(FORWARD).toContain("venue_photos_reported_idx");
    expect(FORWARD).toContain("venue_photos_hidden_idx");
    // The cap counts LIVE rows, so its index is partial on the same predicate.
    expect(FORWARD).toMatch(
      /venue_photos_author_venue_idx[\s\S]{0,160}where moderation_state = 'approved'/,
    );
  });

  it("stays service-role only, with no client grant", () => {
    expect(FORWARD).toContain("alter table public.venue_photos enable row level security");
    expect(FORWARD).toContain("revoke all on table public.venue_photos from anon, authenticated");
    // Never re-open a private table to the browser roles.
    expect(FORWARD).not.toMatch(/using \(true\)/);
    expect(FORWARD).not.toMatch(/grant [\s\S]*? to (anon|authenticated)/);
  });
});

describe("an account that leaves takes its wall photos with it", () => {
  const trigger =
    FORWARD.match(
      /create or replace function public\.stamp_profile_tombstone_on_auth_user_delete[\s\S]*?\$\$;/,
    )?.[0] ?? "";

  it("deletes the serving bytes and any staging bytes", () => {
    expect(trigger).toContain("o.name = vp.object_key");
    expect(trigger).toContain("replace(vp.object_key, '.jpg', '.staging.jpg')");
  });

  it("deletes the rows themselves", () => {
    expect(trigger).toMatch(/delete from public\.venue_photos vp/);
  });

  it("still clears everything the earlier migrations cleared", () => {
    // The trigger is recreated whole, so a field dropped here is a field that
    // silently stops being cleared. These are 0090's and 0096's.
    for (const field of [
      "avatar_object_key",
      "avatar_report_actors",
      "cover_object_key",
      "cover_report_actors",
      "favourite_drink",
      "interests",
      "workplace",
      "tombstoned_at",
    ]) {
      expect(trigger, field).toContain(field);
    }
    expect(trigger).toContain("avatars/");
    expect(trigger).toContain("covers/");
  });
});

describe("the rollback", () => {
  it("drops the table and restores the earlier trigger", () => {
    expect(ROLLBACK).toContain("drop table if exists public.venue_photos");
    expect(ROLLBACK).toContain("create or replace function public.stamp_profile_tombstone_on_auth_user_delete");
    // The restored body must not still be reaching for a table that is gone.
    const restored =
      ROLLBACK.match(
        /create or replace function public\.stamp_profile_tombstone_on_auth_user_delete[\s\S]*?\$\$;/,
      )?.[0] ?? "";
    expect(restored).not.toContain("venue_photos");
    expect(restored).toContain("avatars/");
    expect(restored).toContain("covers/");
  });

  it("says plainly that it does not delete anybody's uploaded bytes", () => {
    expect(ROLLBACK).toMatch(/are NOT deleted here/);
  });
});
