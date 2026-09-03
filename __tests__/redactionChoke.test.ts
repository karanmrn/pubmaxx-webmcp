import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  __resetNightMemoryStore,
  acceptStoryContribution,
  addNightMoment,
  addStoryMoment,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  getNightStory,
  getNightStoryWorkspace,
  getPublishedRecapSource,
  markContributorsDepartedByProfileId,
  proposeNightStoryPublication,
  setMomentPublicationConsent,
  upsertStoryContributor,
} from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

// Build a PUBLISHED, public Story with a Moment from the host AND a Moment from a
// friend contributor whose identity ("@jordanx" / "Jordan") is also written into
// the host's caption. Returns the ids so each test can drive a departure and
// assert the gate erases the friend without destroying the host's Story.
async function publishStoryWithFriend() {
  const friend = await profileStore().createOwned("jordanx", "friend");
  await profileStore().update("jordanx", { displayName: "Jordan" });
  void friend;

  const memory = await createNightMemory("host", { title: "Friday orbit" });
  const hostMoment = await addNightMoment("host", memory!.id, {
    kind: "photo",
    caption: "Great night with @jordanx and the crew",
    mediaObjectKey: "night-media/host/1.webp",
    // Photos need author-confirmed alt text to clear the 5.6 publish gate.
    altText: "The crew raising pints on a bar terrace.",
  });
  const story = await createNightStory("host", { memoryId: memory!.id, title: "Friday orbit with Jordan" });

  await upsertStoryContributor("host", story!.id, { handle: "jordanx", role: "contributor" });
  await acceptStoryContribution("friend", story!.id);
  const friendMoment = await addStoryMoment("friend", story!.id, {
    kind: "photo",
    caption: "My round at the second stop",
    mediaObjectKey: "night-media/friend/1.webp",
    // Photos need author-confirmed alt text to clear the 5.6 publish gate.
    altText: "A tray of drinks at the second bar.",
  });
  await setMomentPublicationConsent("friend", story!.id, friendMoment!.id, "approved");

  const proposed = await proposeNightStoryPublication("host", story!.id, {
    momentIds: [hostMoment!.id, friendMoment!.id],
    visibility: "public",
  });
  const published = await confirmNightStoryPublication("host", story!.id, {
    proposalId: proposed!.proposal.id,
    confirmationToken: proposed!.confirmationToken,
  });

  return { storyId: story!.id, memoryId: memory!.id, hostMomentId: hostMoment!.id, friendMomentId: friendMoment!.id, published };
}

describe("one-choke Story redaction (Wayfinder 5.5)", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
  });

  it("publishes both contributors' Moments before anyone departs", async () => {
    const { storyId, hostMomentId, friendMomentId } = await publishStoryWithFriend();
    const src = await getPublishedRecapSource(storyId);
    expect(src).not.toBeNull();
    expect(src!.moments.map((m) => m.id).sort()).toEqual([hostMomentId, friendMomentId].sort());
    // Nobody departed yet, so the host caption still names the friend.
    expect(src!.moments.find((m) => m.id === hostMomentId)!.caption).toContain("jordanx");
  });

  it("CONSENT WITHDRAWAL: the departing contributor's Moment and identity vanish at the gate", async () => {
    const { storyId, hostMomentId, friendMomentId } = await publishStoryWithFriend();
    await setMomentPublicationConsent("friend", storyId, friendMomentId, "withdrawn");

    const src = await getPublishedRecapSource(storyId);
    expect(src).not.toBeNull();
    // Friend's Moment is gone; the host's Story survives with a scrubbed caption.
    expect(src!.moments.map((m) => m.id)).toEqual([hostMomentId]);
    const hostCaption = src!.moments[0].caption;
    expect(hostCaption).toBe("Great night with a friend and the crew");
    expect(JSON.stringify(src!.moments)).not.toMatch(/jordan/i);
    expect(JSON.stringify(src!.moments)).not.toContain("night-media/friend");
  });

  it("ACCOUNT DELETION: marking contributions departed erases owned Moments the gate would otherwise emit", async () => {
    const { storyId, hostMomentId, friendMomentId } = await publishStoryWithFriend();

    // Deletion marks the contributor withdrawn WITHOUT touching publishedMomentIds
    // — the friend's Moment is still in the allowlist, so this proves the gate's
    // ownership-drop (not just the allowlist) removes it.
    const marked = await markContributorsDepartedByProfileId("friend");
    expect(marked).toBe(1);

    const src = await getPublishedRecapSource(storyId);
    expect(src!.story.publishedMomentIds).toContain(friendMomentId); // allowlist untouched
    expect(src!.moments.map((m) => m.id)).toEqual([hostMomentId]); // yet the Moment is redacted
    expect(src!.moments[0].caption).toBe("Great night with a friend and the crew");
  });

  it("OG / public projection: getNightStory(actorId=null) scrubs the departed identity from the title", async () => {
    const { storyId } = await publishStoryWithFriend();
    await markContributorsDepartedByProfileId("friend");

    const publicStory = await getNightStory(storyId, null);
    expect(publicStory).not.toBeNull();
    // The OG card and any public API read consume this projection.
    expect(publicStory!.title).toBe("Friday orbit with a friend");
    expect("memoryId" in (publicStory as object)).toBe(false); // still the public shape
  });

  it("NON-DESTRUCTIVE: a remaining member still sees the unredacted private Story", async () => {
    const { storyId } = await publishStoryWithFriend();
    await markContributorsDepartedByProfileId("friend");

    // The host is still an accepted member: getNightStory returns the full Story.
    const asHost = await getNightStory(storyId, "host");
    expect(asHost!.title).toBe("Friday orbit with Jordan");
    // And the private source Moment the host owns is untouched in their workspace.
    const workspace = await getNightStoryWorkspace("host", storyId);
    const hostMoment = workspace!.moments.find((m) => m.caption.includes("jordanx"));
    expect(hostMoment).toBeDefined();
    expect(hostMoment!.caption).toBe("Great night with @jordanx and the crew");
  });

  it("deletion marks EVERY Story the account contributes to, and is idempotent", async () => {
    const first = await publishStoryWithFriend();

    // A second Story the same friend contributes a Moment to.
    const memory2 = await createNightMemory("host", { title: "Sunday session" });
    const story2 = await createNightStory("host", { memoryId: memory2!.id, title: "Sunday session" });
    await upsertStoryContributor("host", story2!.id, { handle: "jordanx", role: "contributor" });
    await acceptStoryContribution("friend", story2!.id);
    const friendMoment2 = await addStoryMoment("friend", story2!.id, { kind: "quote", caption: "Sunday roast pint" });
    await setMomentPublicationConsent("friend", story2!.id, friendMoment2!.id, "approved");
    const hostMoment2 = await addNightMoment("host", memory2!.id, { kind: "quote", caption: "Slow one today" });
    const proposed2 = await proposeNightStoryPublication("host", story2!.id, {
      momentIds: [hostMoment2!.id, friendMoment2!.id],
      visibility: "public",
    });
    await confirmNightStoryPublication("host", story2!.id, {
      proposalId: proposed2!.proposal.id,
      confirmationToken: proposed2!.confirmationToken,
    });

    const marked = await markContributorsDepartedByProfileId("friend");
    expect(marked).toBe(2); // one accepted contribution per Story

    // Both Stories redact the friend's Moment.
    const src1 = await getPublishedRecapSource(first.storyId);
    const src2 = await getPublishedRecapSource(story2!.id);
    expect(src1!.moments.map((m) => m.id)).toEqual([first.hostMomentId]);
    expect(src2!.moments.map((m) => m.id)).toEqual([hostMoment2!.id]);

    // Idempotent: re-running marks nothing new (already withdrawn, not accepted).
    expect(await markContributorsDepartedByProfileId("friend")).toBe(0);
  });
});
