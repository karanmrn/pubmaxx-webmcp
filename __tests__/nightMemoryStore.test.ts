import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  __resetNightMemoryStore,
  addNightMoment,
  acceptStoryContribution,
  confirmNightStoryPublication,
  createNightMemory,
  createNightStory,
  findPublishAltTextGap,
  getNightStory,
  getNightStoryWorkspace,
  getPublishedRecapSource,
  listNightStoryInbox,
  markContributorsDepartedByProfileId,
  proposeNightStoryPublication,
  setMomentAltText,
  setMomentPublicationConsent,
  upsertStoryContributor,
} from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

describe("collaborative Night Story storage", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
  });

  it("keeps a Memory and its Moments private until a proposal is confirmed", async () => {
    const memory = await createNightMemory("host", { title: "Friday orbit" });
    const moment = await addNightMoment("host", memory!.id, {
      kind: "photo",
      caption: "The crew at the first stop",
      mediaObjectKey: "night-media/host/photo.webp",
    });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Friday orbit" });

    expect(memory).toMatchObject({ ownerId: "host", visibility: "private" });
    expect(moment).toMatchObject({ ownerId: "host", visibility: "private" });
    expect(story).toMatchObject({ hostEditorId: "host", status: "draft", visibility: "private" });
    expect((await getNightStory(story!.id, null))).toBeNull();
  });

  it("publishes only through a short-lived proposal and separate confirmation token", async () => {
    const memory = await createNightMemory("host", { title: "Friday orbit" });
    const moment = await addNightMoment("host", memory!.id, { kind: "quote", caption: "One more side quest" });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Friday orbit" });
    const proposed = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [moment!.id],
      visibility: "public",
    });

    expect(proposed).toMatchObject({ proposal: { storyId: story!.id, visibility: "public" } });
    expect(JSON.stringify(proposed!.proposal)).not.toContain(proposed!.confirmationToken);
    expect(await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: "wrong-token",
    })).toBeNull();

    const published = await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: proposed!.confirmationToken,
    });
    expect(published).toMatchObject({ status: "published", visibility: "public", publishedMomentIds: [moment!.id] });
    expect(await getNightStory(story!.id, null)).toMatchObject({ id: story!.id, status: "published" });
    const signedInNonContributor = await getNightStory(story!.id, "someone-else");
    expect(signedInNonContributor).not.toHaveProperty("memoryId");
    expect(signedInNonContributor).not.toHaveProperty("hostEditorId");
  });

  it("requires contributor approval and removes a withdrawn Moment from the public Story", async () => {
    const memory = await createNightMemory("host", { title: "Crew night" });
    const moment = await addNightMoment("friend", memory!.id, { kind: "photo", caption: "My photo" }, { allowContributor: true });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Crew night" });
    const withheld = await getNightStoryWorkspace("host", story!.id);
    expect(withheld?.moments).toEqual([]);
    expect(withheld?.caller).toEqual({ role: "host", canEdit: true });
    expect(withheld?.story).not.toHaveProperty("hostEditorId");
    expect(withheld?.story).not.toHaveProperty("memoryId");
    const proposed = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    expect(proposed).toBeNull();

    expect(await setMomentPublicationConsent("friend", story!.id, moment!.id, "approved")).toMatchObject({ status: "approved" });
    expect((await getNightStoryWorkspace("host", story!.id))?.moments[0]).toMatchObject({ caption: "My photo", consent: "approved" });
    const approved = await proposeNightStoryPublication("host", story!.id, { momentIds: [moment!.id], visibility: "public" });
    await confirmNightStoryPublication("host", story!.id, { proposalId: approved!.proposal.id, confirmationToken: approved!.confirmationToken });
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([moment!.id]);

    await setMomentPublicationConsent("friend", story!.id, moment!.id, "withdrawn");
    expect((await getNightStory(story!.id, null))?.publishedMomentIds).toEqual([]);
  });

  it("ships an atomic configured-backend draft authorization check", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716150000_0032_night_story_draft_atomic.sql"), "utf8");
    expect(sql).toContain("update_night_story_draft_atomic");
    expect(sql).toContain("contributor.role in ('host', 'editor')");
    expect(sql).toContain("contributor.status = 'accepted'");
    expect(sql).toContain("create_plan_recap_atomic");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("revoke all on function");
  });

  it("gives contributors consent-only workspace data without other private Moments", async () => {
    await profileStore().createOwned("friend", "friend-user");
    const memory = await createNightMemory("host", { title: "Crew night" });
    await addNightMoment("host", memory!.id, { kind: "quote", caption: "Host private note" });
    const friendMoment = await addNightMoment("friend-user", memory!.id, { kind: "photo", caption: "Friend photo" }, { allowContributor: true });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Crew night" });
    await upsertStoryContributor("host", story!.id, { handle: "friend", role: "contributor" });
    await acceptStoryContribution("friend-user", story!.id);

    const workspace = await getNightStoryWorkspace("friend-user", story!.id);
    expect(workspace?.caller).toEqual({ role: "contributor", canEdit: false });
    expect(workspace?.moments).toEqual([expect.objectContaining({ id: friendMoment!.id, caption: "Friend photo", ownedByCaller: true })]);
    expect(JSON.stringify(workspace)).not.toContain("Host private note");
  });

  it("blocks publishing a photo Moment until the author confirms alt text, and names the photo", async () => {
    const memory = await createNightMemory("host", { title: "Rooftop night" });
    // A PRIVATE save of a photo with no description is unaffected by the gate.
    const photo = await addNightMoment("host", memory!.id, {
      kind: "photo",
      caption: "The rooftop at midnight",
      mediaObjectKey: "night-media/host/rooftop.webp",
    });
    expect(photo).toMatchObject({ visibility: "private", altText: null, altTextConfirmedAt: null });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Rooftop night" });

    // Publication is refused while the photo lacks author-confirmed alt text...
    expect(await proposeNightStoryPublication("host", story!.id, { momentIds: [photo!.id], visibility: "public" })).toBeNull();
    // ...and the block names exactly which photo needs a description.
    expect(await findPublishAltTextGap("host", story!.id, [photo!.id])).toMatchObject({ momentId: photo!.id, label: "The rooftop at midnight" });

    // The author confirms a description by saving their own words.
    const confirmed = await setMomentAltText("host", photo!.id, "A rooftop bar lit by string lights.");
    expect(confirmed).toMatchObject({ altText: "A rooftop bar lit by string lights." });
    expect(confirmed!.altTextConfirmedAt).toBeTruthy();

    expect(await findPublishAltTextGap("host", story!.id, [photo!.id])).toBeNull();
    const proposed = await proposeNightStoryPublication("host", story!.id, { momentIds: [photo!.id], visibility: "public" });
    expect(proposed).toMatchObject({ proposal: { storyId: story!.id } });
    const published = await confirmNightStoryPublication("host", story!.id, {
      proposalId: proposed!.proposal.id,
      confirmationToken: proposed!.confirmationToken,
    });
    expect(published).toMatchObject({ status: "published", publishedMomentIds: [photo!.id] });
  });

  it("only the photo owner may set its alt text, and non-photo Moments never carry one", async () => {
    const memory = await createNightMemory("host", { title: "Owner check" });
    const photo = await addNightMoment("host", memory!.id, { kind: "photo", caption: "A photo", mediaObjectKey: "night-media/host/p.webp" });
    const quote = await addNightMoment("host", memory!.id, { kind: "quote", caption: "A line" });
    expect(await setMomentAltText("intruder", photo!.id, "Sneaky")).toBeNull();
    expect(await setMomentAltText("host", quote!.id, "Quotes have no photo")).toBeNull();
    expect(await setMomentAltText("host", photo!.id, "The owner's words.")).toMatchObject({ altText: "The owner's words." });
  });

  it("grandfathers an already-published photo whose confirmed description is later cleared", async () => {
    const memory = await createNightMemory("host", { title: "Kept night" });
    const photo = await addNightMoment("host", memory!.id, {
      kind: "photo",
      caption: "Neon over the canal",
      mediaObjectKey: "night-media/host/canal.webp",
      altText: "Pink neon reflected in a still canal.",
    });
    expect(photo!.altTextConfirmedAt).toBeTruthy();
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Kept night" });
    const proposed = await proposeNightStoryPublication("host", story!.id, { momentIds: [photo!.id], visibility: "public" });
    await confirmNightStoryPublication("host", story!.id, { proposalId: proposed!.proposal.id, confirmationToken: proposed!.confirmationToken });

    const before = await getPublishedRecapSource(story!.id);
    expect(before?.moments.map((moment) => moment.id)).toEqual([photo!.id]);
    expect(before?.moments[0]?.altText).toBe("Pink neon reflected in a still canal.");

    // Simulate pre-gate / withdrawn description on already-published content.
    await setMomentAltText("host", photo!.id, "");
    const after = await getPublishedRecapSource(story!.id);
    // Still published, still emitted — never retroactively unpublished...
    expect(after?.moments.map((moment) => moment.id)).toEqual([photo!.id]);
    // ...but the recap belt refuses to emit an unconfirmed description as author text.
    expect(after?.moments[0]?.altText).toBeNull();
  });

  it("surfaces alt-text state to the owner in the Story workspace review", async () => {
    const memory = await createNightMemory("host", { title: "Review night" });
    const photo = await addNightMoment("host", memory!.id, { kind: "photo", caption: "Needs a description", mediaObjectKey: "night-media/host/x.webp" });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Review night" });
    const workspace = await getNightStoryWorkspace("host", story!.id);
    expect(workspace?.moments[0]).toMatchObject({ id: photo!.id, hasPhoto: true, altText: null, altTextConfirmed: false });
    await setMomentAltText("host", photo!.id, "A described photo.");
    const refreshed = await getNightStoryWorkspace("host", story!.id);
    expect(refreshed?.moments[0]).toMatchObject({ hasPhoto: true, altText: "A described photo.", altTextConfirmed: true });
  });

  it("composes the 5.5 redaction and the 5.6 alt-text belt in one public emission", async () => {
    // A departed contributor's still-published photo is DROPPED (5.5 redaction),
    // and on the surviving owner's photo an unconfirmed description is emitted as
    // NULL — never dropped (5.6 alt-text belt). Both effects, one emission.
    await profileStore().createOwned("friend", "friend-user");
    const memory = await createNightMemory("host", { title: "Two-photo night" });
    const hostPhoto = await addNightMoment("host", memory!.id, {
      kind: "photo",
      caption: "Host rooftop",
      mediaObjectKey: "night-media/host/rooftop.webp",
      altText: "A rooftop bar lit by string lights.",
    });
    const friendPhoto = await addNightMoment("friend-user", memory!.id, {
      kind: "photo",
      caption: "Friend's neon shot",
      mediaObjectKey: "night-media/friend/neon.webp",
      altText: "Pink neon over a wet street.",
    }, { allowContributor: true });
    const story = await createNightStory("host", { memoryId: memory!.id, title: "Two-photo night" });
    await upsertStoryContributor("host", story!.id, { handle: "friend", role: "contributor" });
    await acceptStoryContribution("friend-user", story!.id);
    await setMomentPublicationConsent("friend-user", story!.id, friendPhoto!.id, "approved");

    // Both photos carry confirmed alt text, so publication proceeds for both.
    const proposed = await proposeNightStoryPublication("host", story!.id, {
      momentIds: [hostPhoto!.id, friendPhoto!.id],
      visibility: "public",
    });
    await confirmNightStoryPublication("host", story!.id, { proposalId: proposed!.proposal.id, confirmationToken: proposed!.confirmationToken });
    const before = await getPublishedRecapSource(story!.id);
    expect(before?.moments.map((moment) => moment.id).sort()).toEqual([hostPhoto!.id, friendPhoto!.id].sort());

    // The friend deletes their account (both photos still in publishedMomentIds)...
    expect(await markContributorsDepartedByProfileId("friend-user")).toBe(1);
    // ...and the host's own description is later cleared (a grandfathered survivor).
    await setMomentAltText("host", hostPhoto!.id, "");

    const after = await getPublishedRecapSource(story!.id);
    // 5.5: the departed friend's photo is gone from the emission entirely.
    expect(after?.moments.map((moment) => moment.id)).toEqual([hostPhoto!.id]);
    // 5.6: the surviving host photo is STILL emitted, but its unconfirmed
    // description is nulled — media never dropped, text never presented unconfirmed.
    expect(after?.moments[0]?.altText).toBeNull();
    expect(after?.moments[0]?.mediaObjectKey).toBe("night-media/host/rooftop.webp");
  });

  it("sorts every pending invitation ahead of a long accepted Story shelf", async () => {
    await profileStore().createOwned("friend", "friend-user");
    const memory = await createNightMemory("host", { title: "Story shelf" });
    const pending = await createNightStory("host", { memoryId: memory!.id, title: "Old invitation" });
    await upsertStoryContributor("host", pending!.id, { handle: "friend", role: "contributor" });
    for (let index = 0; index < 9; index += 1) {
      const story = await createNightStory("host", { memoryId: memory!.id, title: `Accepted ${index}` });
      await upsertStoryContributor("host", story!.id, { handle: "friend", role: "contributor" });
      await acceptStoryContribution("friend-user", story!.id);
    }
    const inbox = await listNightStoryInbox("friend-user");
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    expect(inbox.value).toHaveLength(10);
    expect(inbox.value[0]).toMatchObject({ id: pending!.id, membership: { status: "invited" } });
  });
});
