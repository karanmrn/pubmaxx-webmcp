// A moderator's takedown of a cover must TAKE THE COVER DOWN.
//
// The admin console hides a cover by writing `profiles.cover_moderation_state`.
// The serve route used to treat that refusal as an invitation to ask the
// five-photo rotation instead, whose own row the admin lane never touched, so
// the hidden bytes kept answering 200 with a public, cacheable header. These
// cases pin both halves of the fix: a moderation decision is terminal on the
// serve path, and the decision is mirrored onto the rotation rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { supabaseConfigured, coverAdminRef } = vi.hoisted(() => ({
  supabaseConfigured: { value: false },
  coverAdminRef: { client: null as unknown },
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => supabaseConfigured.value,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => {
      if (!coverAdminRef.client) throw new Error("Supabase not configured.");
      return coverAdminRef.client;
    },
  };
});

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET as serveCover } from "@/app/api/cover/[profileId]/[generation]/route";
import { __setCoverServeRouteDepsForTest } from "@/lib/profileImageServeRouteDeps.server";
import { moderateProfileImageAcrossStores } from "@/lib/profileCoverModeration.server";
import {
  __resetProfileCoverPhotos,
  mirrorFirstCoverOntoProfile,
  memoryProfileCoverPhotoStore,
  ProfileCoverGuardUnavailableError,
  ProfileCoverCapReachedError,
  ProfileCoverUploadBlockedError,
  publicCoverUrls,
  supabaseProfileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
  profileImageState,
} from "@/lib/profileStore";

const HANDLE = "alice";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const FIRST_GENERATION = "55555555-5555-4555-8555-555555555555";
const SECOND_GENERATION = "66666666-6666-4666-8666-666666666666";
const firstKey = profileImageServingKey("cover", PROFILE_ID, FIRST_GENERATION);
const secondKey = profileImageServingKey("cover", PROFILE_ID, SECOND_GENERATION);

const JPEG = {
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
  contentType: "image/jpeg" as const,
};

/**
 * The profile row as the admin console leaves it after a hide: the mirror is
 * `hidden`, and the rotation - which nothing in the console names - is still
 * approved. That disagreement is the whole finding.
 */
function serveWith(coverModerationState: "approved" | "hidden" | "absent"): void {
  supabaseConfigured.value = true;
  __setCoverServeRouteDepsForTest({
    getProfileById: async (): Promise<ProfileRecord> => ({
      id: PROFILE_ID,
      handle: HANDLE,
      userId: "user-alice",
      ...(coverModerationState === "absent"
        ? {}
        : {
            coverObjectKey: firstKey,
            coverGeneration: FIRST_GENERATION,
            coverModerationState,
          }),
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }),
    extraServingKey: (profileId, generation) =>
      memoryProfileCoverPhotoStore.approvedObjectKey(profileId, generation),
    downloadObject: async () => JPEG,
  });
}

async function seedRotation(): Promise<void> {
  await memoryProfileCoverPhotoStore.create({
    id: "77777777-7777-4777-8777-777777777771",
    profileId: PROFILE_ID,
    generation: FIRST_GENERATION,
    objectKey: firstKey,
  });
  await memoryProfileCoverPhotoStore.create({
    id: "77777777-7777-4777-8777-777777777772",
    profileId: PROFILE_ID,
    generation: SECOND_GENERATION,
    objectKey: secondKey,
  });
}

function serve(generation: string): Promise<Response> {
  return serveCover(new Request("http://localhost/x"), {
    params: Promise.resolve({ profileId: PROFILE_ID, generation }),
  });
}

beforeEach(async () => {
  __resetMemoryProfiles();
  __resetProfileCoverPhotos();
  await seedRotation();
});

afterEach(() => {
  supabaseConfigured.value = false;
  coverAdminRef.client = null;
});

describe("a hidden cover is not served out of the rotation", () => {
  it("serves the rotation normally while the cover is approved", async () => {
    serveWith("approved");
    expect((await serve(SECOND_GENERATION)).status).toBe(200);
  });

  it("refuses the MIRRORED generation once a moderator hid it", async () => {
    serveWith("hidden");
    const response = await serve(FIRST_GENERATION);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a rotation-only generation too, with the rotation row still approved", async () => {
    serveWith("hidden");
    // The rotation itself has not been told anything: this is the exact state
    // the admin lane used to leave behind.
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(PROFILE_ID, SECOND_GENERATION),
    ).toBe(secondKey);

    const response = await serve(SECOND_GENERATION);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("serves an approved rotation when the back-compat mirror is absent", async () => {
    serveWith("absent");
    expect((await serve(SECOND_GENERATION)).status).toBe(200);
  });
});

// The in-memory profile store mints its own ids, so this section seeds the
// rotation under the id the store actually gave the handle.
describe("moderateProfileImageAcrossStores — the two lanes agree", () => {
  let ownedProfileId = "";

  beforeEach(async () => {
    __resetProfileCoverPhotos();
    ownedProfileId = __seedMemoryOwnedProfile(HANDLE, "user-alice").id;
    await memoryProfileStore.setOwnedImage(HANDLE, "cover", {
      objectKey: profileImageServingKey("cover", ownedProfileId, FIRST_GENERATION),
      generation: FIRST_GENERATION,
      moderationState: "approved",
    });
    for (const [index, generation] of [FIRST_GENERATION, SECOND_GENERATION].entries()) {
      await memoryProfileCoverPhotoStore.create({
        id: `88888888-8888-4888-8888-88888888888${index}`,
        profileId: ownedProfileId,
        generation,
        objectKey: profileImageServingKey("cover", ownedProfileId, generation),
      });
    }
  });

  it("hides every cover in the rotation, not only the mirrored one", async () => {
    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "hide", "abusive")).toBe(
      true,
    );

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toEqual([]);
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(ownedProfileId, SECOND_GENERATION),
    ).toBeNull();
  });

  it("puts the whole rotation back on restore", async () => {
    await moderateProfileImageAcrossStores(HANDLE, "cover", "hide");
    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "restore")).toBe(true);

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toHaveLength(2);
  });

  it("does not restore rotation URLs after soft-delete purges cover bytes", async () => {
    await moderateProfileImageAcrossStores(HANDLE, "cover", "hide");
    await memoryProfileStore.softDeleteForCaller(HANDLE, "user-alice");

    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "restore")).toBe(
      false,
    );
    expect(await publicCoverUrls(ownedProfileId)).toEqual([]);
  });

  it("keeps both stores hidden when a takedown lands before a stale owner mirror", async () => {
    const staleApproved = await memoryProfileCoverPhotoStore.listApproved(ownedProfileId);

    await moderateProfileImageAcrossStores(HANDLE, "cover", "hide");
    await mirrorFirstCoverOntoProfile(HANDLE, staleApproved);

    const profile = await memoryProfileStore.getByHandle(HANDLE);
    expect(profileImageState(profile!, "cover").moderationState).toBe("hidden");
    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toEqual([]);
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(
        ownedProfileId,
        SECOND_GENERATION,
      ),
    ).toBeNull();
  });

  it("refuses an owner upload after a moderator takedown", async () => {
    await moderateProfileImageAcrossStores(HANDLE, "cover", "hide");
    const thirdGeneration = "99999999-9999-4999-8999-999999999999";
    const countBefore = await memoryProfileCoverPhotoStore.countForProfile(ownedProfileId);

    await expect(
      memoryProfileCoverPhotoStore.create({
        id: "88888888-8888-4888-8888-888888888889",
        profileId: ownedProfileId,
        generation: thirdGeneration,
        objectKey: profileImageServingKey("cover", ownedProfileId, thirdGeneration),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverUploadBlockedError);

    expect(await memoryProfileCoverPhotoStore.countForProfile(ownedProfileId)).toBe(
      countBefore,
    );
    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toEqual([]);
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(
        ownedProfileId,
        thirdGeneration,
      ),
    ).toBeNull();
  });

  it("removes a durable upload when a takedown lands during its write", async () => {
    const profile = {
      id: ownedProfileId,
      handle: HANDLE,
      user_id: "user-alice",
      cover_moderation_state: "approved",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const rows: Array<Record<string, unknown>> = [];
    const insert = vi.fn(async (row: Record<string, unknown>) => {
      rows.push({ ...row });
      profile.cover_moderation_state = "hidden";
      return { error: null };
    });

    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: [{ ...profile }], error: null }),
              }),
            }),
          };
        }
        if (table !== "profile_cover_photos") throw new Error(`Unexpected ${table}`);
        return {
          select: () => {
            const query = {
              eq: () => query,
              order: () => query,
              limit: async () => ({ data: rows.map((row) => ({ ...row })), error: null }),
            };
            return query;
          },
          insert,
          update(patch: Record<string, unknown>) {
            return {
              eq: () => ({
                select: async () => {
                  for (const row of rows) Object.assign(row, patch);
                  return { data: rows.map(({ id }) => ({ id })), error: null };
                },
              }),
            };
          },
          delete() {
            let id = "";
            let profileId = "";
            const query = {
              eq(column: string, value: string) {
                if (column === "id") id = value;
                if (column === "profile_id") profileId = value;
                return query;
              },
              async select() {
                const index = rows.findIndex(
                  (row) => row.id === id && row.profile_id === profileId,
                );
                const removed = index >= 0 ? rows.splice(index, 1) : [];
                return { data: removed, error: null };
              },
            };
            return query;
          },
        };
      },
    };
    supabaseConfigured.value = true;
    const thirdGeneration = "99999999-9999-4999-8999-999999999998";

    await expect(
      supabaseProfileCoverPhotoStore.create({
        id: "88888888-8888-4888-8888-888888888887",
        profileId: ownedProfileId,
        generation: thirdGeneration,
        objectKey: profileImageServingKey("cover", ownedProfileId, thirdGeneration),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverUploadBlockedError);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([]);
  });

  it("treats a profile guard outage before insert as unavailable", async () => {
    const insert = vi.fn();
    const moderate = vi.fn();
    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({
                  data: null,
                  error: { message: "profile read unavailable" },
                }),
              }),
            }),
          };
        }
        return {
          insert,
          update: moderate,
        };
      },
    };
    supabaseConfigured.value = true;

    await expect(
      supabaseProfileCoverPhotoStore.create({
        id: "88888888-8888-4888-8888-888888888886",
        profileId: ownedProfileId,
        generation: "99999999-9999-4999-8999-999999999996",
        objectKey: profileImageServingKey(
          "cover",
          ownedProfileId,
          "99999999-9999-4999-8999-999999999996",
        ),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverGuardUnavailableError);

    expect(insert).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
  });

  it("removes only the attempted upload when the guard fails after insert", async () => {
    const existing = {
      id: "88888888-8888-4888-8888-888888888885",
      profile_id: ownedProfileId,
      position: 1,
      generation: FIRST_GENERATION,
      object_key: profileImageServingKey(
        "cover",
        ownedProfileId,
        FIRST_GENERATION,
      ),
      moderation_state: "approved",
      report_count: 0,
      report_actors: [],
      created_at: "2026-08-01T00:00:00.000Z",
    };
    const rows: Array<Record<string, unknown>> = [{ ...existing }];
    let profileReads = 0;
    const moderate = vi.fn();

    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => {
                  profileReads += 1;
                  return profileReads === 1
                    ? {
                        data: [
                          {
                            id: ownedProfileId,
                            handle: HANDLE,
                            user_id: "user-alice",
                            cover_moderation_state: "approved",
                            created_at: "2026-08-01T00:00:00.000Z",
                            updated_at: "2026-08-01T00:00:00.000Z",
                          },
                        ],
                        error: null,
                      }
                    : {
                        data: null,
                        error: { message: "profile read unavailable" },
                      };
                },
              }),
            }),
          };
        }
        if (table !== "profile_cover_photos") throw new Error(`Unexpected ${table}`);
        return {
          select: () => {
            const query = {
              eq: () => query,
              order: () => query,
              limit: async () => ({
                data: rows.map((row) => ({ ...row })),
                error: null,
              }),
            };
            return query;
          },
          insert: async (row: Record<string, unknown>) => {
            rows.push({ ...row });
            return { error: null };
          },
          update: moderate,
          delete() {
            let id = "";
            let profileId = "";
            const query = {
              eq(column: string, value: string) {
                if (column === "id") id = value;
                if (column === "profile_id") profileId = value;
                return query;
              },
              async select() {
                const index = rows.findIndex(
                  (row) => row.id === id && row.profile_id === profileId,
                );
                const removed = index >= 0 ? rows.splice(index, 1) : [];
                return { data: removed, error: null };
              },
            };
            return query;
          },
        };
      },
    };
    supabaseConfigured.value = true;
    const generation = "99999999-9999-4999-8999-999999999995";

    await expect(
      supabaseProfileCoverPhotoStore.create({
        id: "88888888-8888-4888-8888-888888888884",
        profileId: ownedProfileId,
        generation,
        objectKey: profileImageServingKey("cover", ownedProfileId, generation),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverGuardUnavailableError);

    expect(profileReads).toBe(2);
    expect(moderate).not.toHaveBeenCalled();
    expect(rows).toEqual([existing]);
  });

  it("does not let guard-failure recovery resurrect a landed takedown", async () => {
    const profile = {
      id: ownedProfileId,
      handle: HANDLE,
      user_id: "user-alice",
      cover_object_key: profileImageServingKey(
        "cover",
        ownedProfileId,
        FIRST_GENERATION,
      ),
      cover_generation: FIRST_GENERATION,
      cover_moderation_state: "approved",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const rows = [
      {
        id: "88888888-8888-4888-8888-888888888880",
        profile_id: ownedProfileId,
        position: 1,
        generation: FIRST_GENERATION,
        object_key: profileImageServingKey(
          "cover",
          ownedProfileId,
          FIRST_GENERATION,
        ),
        moderation_state: "approved",
        report_count: 0,
        report_actors: [],
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "88888888-8888-4888-8888-888888888881",
        profile_id: ownedProfileId,
        position: 2,
        generation: SECOND_GENERATION,
        object_key: profileImageServingKey(
          "cover",
          ownedProfileId,
          SECOND_GENERATION,
        ),
        moderation_state: "approved",
        report_count: 0,
        report_actors: [],
        created_at: "2026-08-01T00:00:01.000Z",
      },
    ];
    let profileReads = 0;
    const upserts: Array<Array<Record<string, unknown>>> = [];

    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => {
                  profileReads += 1;
                  return profileReads === 1
                    ? { data: [{ ...profile }], error: null }
                    : {
                        data: null,
                        error: { message: "profile read unavailable" },
                      };
                },
              }),
            }),
          };
        }
        if (table !== "profile_cover_photos") throw new Error(`Unexpected ${table}`);
        return {
          select: () => {
            let moderationState: string | null = null;
            const builder = {
              eq(column: string, value: string) {
                if (column === "moderation_state") moderationState = value;
                return builder;
              },
              order() {
                return builder;
              },
              async limit() {
                return {
                  data: rows
                  .filter(
                    (row) =>
                      row.profile_id === ownedProfileId &&
                      (!moderationState || row.moderation_state === moderationState),
                  )
                  .map((row) => ({ ...row })),
                  error: null,
                };
              },
            };
            return builder;
          },
          update(patch: { moderation_state?: string }) {
            return {
              eq: () => ({
                select: async () => {
                  for (const row of rows) {
                    if (patch.moderation_state) {
                      row.moderation_state = patch.moderation_state;
                    }
                  }
                  return { data: rows.map(({ id }) => ({ id })), error: null };
                },
              }),
            };
          },
          async upsert(nextRows: Array<Record<string, unknown>>) {
            upserts.push(nextRows.map((row) => ({ ...row })));
            for (const next of nextRows) {
              const current = rows.find((row) => row.id === next.id);
              if (current) Object.assign(current, next);
            }
            if (upserts.length === 1) {
              for (const row of rows) row.moderation_state = "hidden";
            }
            return { error: null };
          },
        };
      },
    };
    supabaseConfigured.value = true;

    await expect(
      supabaseProfileCoverPhotoStore.reorder(
        ownedProfileId,
        [rows[1].id, rows[0].id],
      ),
    ).rejects.toBeInstanceOf(ProfileCoverGuardUnavailableError);

    expect(profileReads).toBe(2);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.every((row) => !("moderation_state" in row))).toBe(true);
    expect(rows.every((row) => row.moderation_state === "hidden")).toBe(true);
  });

  it("owner reorder cannot restore a moderator-hidden cover", async () => {
    const profile = {
      id: ownedProfileId,
      handle: HANDLE,
      user_id: "user-alice",
      cover_object_key: profileImageServingKey(
        "cover",
        ownedProfileId,
        FIRST_GENERATION,
      ),
      cover_generation: FIRST_GENERATION,
      cover_moderation_state: "approved",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const rows = [
      {
        id: "88888888-8888-4888-8888-888888888870",
        profile_id: ownedProfileId,
        position: 1,
        generation: FIRST_GENERATION,
        object_key: profileImageServingKey(
          "cover",
          ownedProfileId,
          FIRST_GENERATION,
        ),
        moderation_state: "hidden",
        report_count: 0,
        report_actors: [],
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "88888888-8888-4888-8888-888888888871",
        profile_id: ownedProfileId,
        position: 2,
        generation: SECOND_GENERATION,
        object_key: profileImageServingKey(
          "cover",
          ownedProfileId,
          SECOND_GENERATION,
        ),
        moderation_state: "hidden",
        report_count: 0,
        report_actors: [],
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ];
    const upserts: Array<Array<Record<string, unknown>>> = [];

    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: [{ ...profile }], error: null }),
              }),
            }),
          };
        }
        if (table !== "profile_cover_photos") throw new Error(`Unexpected ${table}`);
        return {
          select: () => {
            let moderationState: string | null = null;
            const builder = {
              eq(column: string, value: string) {
                if (column === "moderation_state") moderationState = value;
                if (column === "profile_id") return builder;
                return builder;
              },
              order() {
                return builder;
              },
              async limit() {
                return {
                  data: rows
                    .filter(
                      (row) =>
                        row.profile_id === ownedProfileId &&
                        (!moderationState || row.moderation_state === moderationState),
                    )
                    .map((row) => ({ ...row })),
                  error: null,
                };
              },
            };
            return builder;
          },
          update(patch: { moderation_state?: string }) {
            return {
              eq: () => ({
                select: async () => {
                  for (const row of rows) {
                    if (patch.moderation_state) {
                      row.moderation_state = patch.moderation_state;
                    }
                  }
                  return { data: rows.map(({ id }) => ({ id })), error: null };
                },
              }),
            };
          },
          async upsert(nextRows: Array<Record<string, unknown>>) {
            upserts.push(nextRows.map((row) => ({ ...row })));
            for (const next of nextRows) {
              const current = rows.find((row) => row.id === next.id);
              if (current) Object.assign(current, next);
            }
            return { error: null };
          },
        };
      },
    };
    supabaseConfigured.value = true;

    const result = await supabaseProfileCoverPhotoStore.reorder(
      ownedProfileId,
      [rows[1].id, rows[0].id],
    );

    expect(result).toEqual([]);
    expect(upserts).toHaveLength(0);
    expect(rows.every((row) => row.moderation_state === "hidden")).toBe(true);
  });

  it("mirrors hide onto rotation when the profile has no cover mirror image", async () => {
    __resetProfileCoverPhotos();
    const profile = __seedMemoryOwnedProfile(HANDLE, "user-alice");
    ownedProfileId = profile.id;
    for (const [index, generation] of [FIRST_GENERATION, SECOND_GENERATION].entries()) {
      await memoryProfileCoverPhotoStore.create({
        id: `88888888-8888-4888-8888-88888888888${index}`,
        profileId: ownedProfileId,
        generation,
        objectKey: profileImageServingKey("cover", ownedProfileId, generation),
      });
    }

    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "hide")).toBe(true);
    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toEqual([]);
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(
        ownedProfileId,
        SECOND_GENERATION,
      ),
    ).toBeNull();
  });

  it("leaves the rotation alone for the face", async () => {
    await memoryProfileStore.setOwnedImage(HANDLE, "avatar", {
      objectKey: profileImageServingKey("avatar", ownedProfileId, FIRST_GENERATION),
      generation: FIRST_GENERATION,
      moderationState: "approved",
    });
    await moderateProfileImageAcrossStores(HANDLE, "avatar", "hide");

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toHaveLength(2);
  });
});

describe("cover rotation cap", () => {
  it("propagates an unreadable durable moderator queue", async () => {
    const query = {
      gt: () => query,
      is: () => query,
      order: () => query,
      limit: async () => ({ data: null, error: { message: "queue unavailable" } }),
    };
    coverAdminRef.client = { from: () => ({ select: () => query }) };
    supabaseConfigured.value = true;

    await expect(supabaseProfileCoverPhotoStore.listForReview()).rejects.toThrow(
      "queue unavailable",
    );
  });

  it("makes memory and durable stores refuse the same sixth live cover", async () => {
    __resetProfileCoverPhotos();
    const memoryProfile = __seedMemoryOwnedProfile(HANDLE, "user-alice");
    for (let index = 0; index < 5; index += 1) {
      const generation = `55555555-5555-4555-8555-55555555555${index}`;
      await memoryProfileCoverPhotoStore.create({
        id: `77777777-7777-4777-8777-77777777777${index}`,
        profileId: memoryProfile.id,
        generation,
        objectKey: profileImageServingKey("cover", memoryProfile.id, generation),
      });
    }
    const memoryGeneration = "99999999-9999-4999-8999-999999999991";
    await expect(
      memoryProfileCoverPhotoStore.create({
        id: "99999999-9999-4999-8999-999999999992",
        profileId: memoryProfile.id,
        generation: memoryGeneration,
        objectKey: profileImageServingKey(
          "cover",
          memoryProfile.id,
          memoryGeneration,
        ),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverCapReachedError);

    const durableRows = Array.from({ length: 5 }, (_, index) => {
      const generation = `66666666-6666-4666-8666-66666666666${index}`;
      return {
        id: `88888888-8888-4888-8888-88888888888${index}`,
        profile_id: PROFILE_ID,
        position: index + 1,
        generation,
        object_key: profileImageServingKey("cover", PROFILE_ID, generation),
        moderation_state: "approved",
        report_count: 0,
        report_actors: [],
        created_at: `2026-08-01T00:00:0${index}.000Z`,
      };
    });
    const insert = vi.fn();
    coverAdminRef.client = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: PROFILE_ID,
                      handle: HANDLE,
                      user_id: "user-alice",
                      cover_moderation_state: "approved",
                      created_at: "2026-08-01T00:00:00.000Z",
                      updated_at: "2026-08-01T00:00:00.000Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        const query = {
          eq: () => query,
          order: () => query,
          limit: async () => ({ data: durableRows, error: null }),
        };
        return { select: () => query, insert };
      },
    };
    supabaseConfigured.value = true;
    const durableGeneration = "99999999-9999-4999-8999-999999999993";

    await expect(
      supabaseProfileCoverPhotoStore.create({
        id: "99999999-9999-4999-8999-999999999994",
        profileId: PROFILE_ID,
        generation: durableGeneration,
        objectKey: profileImageServingKey(
          "cover",
          PROFILE_ID,
          durableGeneration,
        ),
      }),
    ).rejects.toBeInstanceOf(ProfileCoverCapReachedError);
    expect(insert).not.toHaveBeenCalled();
  });
});
