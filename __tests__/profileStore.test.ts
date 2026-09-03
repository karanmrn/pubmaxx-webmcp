import { beforeEach, describe, expect, it } from "vitest";

import { RESERVED_CONTRIBUTOR_HANDLE_INPUTS } from "@/__tests__/fixtures/reservedContributorHandles";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
  profileImageState,
  type ProfileRecord,
} from "@/lib/profileStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";

// Force the in-memory path: Vercel runs vitest with the project env set, which
// would otherwise route the store at the Supabase adapter. Deleting the two keys
// here keeps every case in-process, deterministic, and network-free. (The
// memoryProfileStore under test is the concrete memory implementation, so the
// env only matters for callers that pick a store via isSupabaseConfigured —
// deleting them keeps the whole suite honest regardless.)
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
});

async function seed(handle: string): Promise<ProfileRecord> {
  return memoryProfileStore.ensure(handle);
}

describe("profileStore.update — memory round-trip", () => {
  it("returns null for a handle that has no row yet", async () => {
    const result = await memoryProfileStore.update("ghost", { displayName: "Nobody" });
    expect(result).toBeNull();
  });

  it("persists a clean patch and reads it back", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      displayName: "Cheap Pint Ken",
      bio: "Chasing the sub-4 pint across Zone 2.",
      homeCity: "London",
      avatarUrl: "https://cdn.test/ken.jpg",
    });
    expect(updated).not.toBeNull();
    expect(updated!.displayName).toBe("Cheap Pint Ken");
    expect(updated!.bio).toBe("Chasing the sub-4 pint across Zone 2.");
    expect(updated!.homeCity).toBe("London");
    expect(updated!.avatarUrl).toBe("https://cdn.test/ken.jpg");

    // Durable: a fresh read sees the same values.
    const read = await memoryProfileStore.getByHandle("ken");
    expect(read!.displayName).toBe("Cheap Pint Ken");
    expect(read!.avatarUrl).toBe("https://cdn.test/ken.jpg");
  });

  it("normalizes the handle before locating the row", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("@KEN", { displayName: "Ken" });
    expect(updated).not.toBeNull();
    expect(updated!.handle).toBe("ken");
  });

  it("leaves an omitted field untouched (partial patch)", async () => {
    await seed("ken");
    await memoryProfileStore.update("ken", { displayName: "Ken", bio: "Original bio." });
    // A second patch that only sets homeCity must not wipe the bio.
    const updated = await memoryProfileStore.update("ken", { homeCity: "Camden" });
    expect(updated!.bio).toBe("Original bio.");
    expect(updated!.homeCity).toBe("Camden");
    expect(updated!.displayName).toBe("Ken");
  });

  it("clears a field when a present key is empty", async () => {
    await seed("ken");
    await memoryProfileStore.update("ken", { bio: "To be cleared." });
    const updated = await memoryProfileStore.update("ken", { bio: "" });
    expect(updated!.bio).toBeUndefined();
  });
});

describe("profileStore.update — cleans + caps fields", () => {
  it("strips inline HTML angle brackets and control chars", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      displayName: "Ken <script>alert(1)</script>",
      bio: "line one\u0000line two",
    });
    expect(updated!.displayName).not.toContain("<");
    expect(updated!.displayName).not.toContain(">");
    // Control chars collapse to a space, not vanish into a joined word.
    expect(updated!.bio).toBe("line one line two");
  });

  it("caps displayName at 60 characters", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      displayName: "a".repeat(200),
    });
    expect(updated!.displayName).toHaveLength(60);
  });

  it("caps bio at 280 characters", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      bio: "b".repeat(500),
    });
    expect(updated!.bio).toHaveLength(280);
  });

  it("caps homeCity at 60 characters", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      homeCity: "c".repeat(120),
    });
    expect(updated!.homeCity).toHaveLength(60);
  });

  it("collapses runs of whitespace and trims", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      displayName: "   Cheap    Pint   Ken   ",
    });
    expect(updated!.displayName).toBe("Cheap Pint Ken");
  });
});

describe("profileStore.update — avatar URL validation", () => {
  it("accepts an https URL", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      avatarUrl: "https://cdn.example.com/a.png",
    });
    expect(updated!.avatarUrl).toBe("https://cdn.example.com/a.png");
  });

  it("accepts an http URL", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      avatarUrl: "http://cdn.example.com/a.png",
    });
    expect(updated!.avatarUrl).toBe("http://cdn.example.com/a.png");
  });

  it("rejects a javascript: scheme (dropped to empty)", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      avatarUrl: "javascript:alert(1)",
    });
    expect(updated!.avatarUrl).toBeUndefined();
  });

  it("rejects a data: URL (dropped to empty)", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      avatarUrl: "data:image/png;base64,AAAA",
    });
    expect(updated!.avatarUrl).toBeUndefined();
  });

  it("rejects a bare non-URL string (dropped to empty)", async () => {
    await seed("ken");
    const updated = await memoryProfileStore.update("ken", {
      avatarUrl: "not a url",
    });
    expect(updated!.avatarUrl).toBeUndefined();
  });

  it("rejects an over-long URL past the 400-char cap", async () => {
    await seed("ken");
    const longUrl = `https://cdn.example.com/${"x".repeat(500)}.png`;
    const updated = await memoryProfileStore.update("ken", { avatarUrl: longUrl });
    expect(updated!.avatarUrl).toBeUndefined();
  });

  it("clears the avatar when passed an empty string", async () => {
    await seed("ken");
    await memoryProfileStore.update("ken", { avatarUrl: "https://cdn.example.com/a.png" });
    const cleared = await memoryProfileStore.update("ken", { avatarUrl: "" });
    expect(cleared!.avatarUrl).toBeUndefined();
  });
});

describe("profileStore.update — empty patch is a read", () => {
  it("returns the current row unchanged when no writable field is sent", async () => {
    const seeded = await seed("ken");
    await memoryProfileStore.update("ken", { displayName: "Ken" });
    const result = await memoryProfileStore.update("ken", {});
    expect(result).not.toBeNull();
    expect(result!.id).toBe(seeded.id);
    expect(result!.displayName).toBe("Ken");
  });
});

describe("profileStore.softDeleteForCaller + getHandleByUserId", () => {
  it.each(RESERVED_CONTRIBUTOR_HANDLE_INPUTS)(
    "refuses to create reserved handle %s at the store boundary",
    async (handle) => {
      await expect(
        memoryProfileStore.createOwned(handle, "user-abc"),
      ).rejects.toThrow("That handle is not available.");
      expect(await memoryProfileStore.getByHandle(handle)).toBeNull();
    },
  );

  it("clears editable fields but keeps the handle row", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    await memoryProfileStore.update("ken", {
      displayName: "Ken",
      bio: "bye",
      homeCity: "London",
      avatarUrl: "https://cdn.test/ken.jpg",
    });
    const cleared = await memoryProfileStore.softDeleteForCaller("ken", "user-abc");
    expect(cleared.status).toBe("deleted");
    if (cleared.status !== "deleted") throw new Error("Expected profile deletion.");
    expect(cleared.profile.handle).toBe("ken");
    expect(cleared.profile.userId).toBe("user-abc");
    expect(cleared.profile.displayName).toBeUndefined();
    expect(cleared.profile.bio).toBeUndefined();
    expect(cleared.profile.homeCity).toBeUndefined();
    expect(cleared.profile.avatarUrl).toBeUndefined();
  });

  it("soft-deletes a profile with a cover and clears its full image state", async () => {
    const profile = await memoryProfileStore.createOwned("ken", "user-abc");
    const firstGeneration = "11111111-1111-4111-8111-111111111111";
    await memoryProfileStore.setOwnedImage("ken", "cover", {
      objectKey: profileImageServingKey("cover", profile.id, firstGeneration),
      generation: firstGeneration,
      moderationState: "approved",
    });
    expect(
      await memoryProfileStore.reportOwnedImage(
        "ken",
        "cover",
        "unsafe",
        "reporter-one",
      ),
    ).toBe(true);
    expect(await memoryProfileStore.moderateOwnedImage("ken", "cover", "hide")).toBe(
      true,
    );

    const deleted = await memoryProfileStore.softDeleteForCaller("ken", "user-abc");
    expect(deleted.status).toBe("deleted");
    if (deleted.status !== "deleted") throw new Error("Expected profile deletion.");
    expect(profileImageState(deleted.profile, "cover")).toEqual({});
    expect(await memoryProfileStore.moderateOwnedImage("ken", "cover", "restore")).toBe(
      false,
    );
  });

  it("resolves a linked handle by user id", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    expect(await memoryProfileStore.getHandleByUserId("user-abc")).toBe("ken");
    expect(await memoryProfileStore.getHandleByUserId("missing")).toBeNull();
  });
});
