import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token || null;
  },
}));

import { GET as LIST_MEMORIES, POST as CREATE_MEMORY } from "@/app/api/night-memories/route";
import { GET as LIST_MOMENTS, POST as ADD_MEMORY_MOMENT } from "@/app/api/night-memories/[id]/moments/route";
import { GET as LIST_STORIES, POST as CREATE_STORY } from "@/app/api/night-stories/route";
import { GET as GET_STORY, PATCH as UPDATE_STORY } from "@/app/api/night-stories/[id]/route";
import { GET as GET_STORY_WORKSPACE } from "@/app/api/night-stories/[id]/workspace/route";
import { DELETE as DECLINE_CONTRIBUTOR, PATCH as ACCEPT_CONTRIBUTOR, POST as INVITE_CONTRIBUTOR } from "@/app/api/night-stories/[id]/contributors/route";
import { POST as ADD_STORY_MOMENT } from "@/app/api/night-stories/[id]/moments/route";
import { POST as SET_STORY_CONSENT } from "@/app/api/night-stories/[id]/consents/route";
import { POST as PROPOSE } from "@/app/api/night-stories/[id]/publish-proposals/route";
import { POST as CONFIRM } from "@/app/api/night-stories/[id]/publish-confirmations/route";
import { PATCH as SET_ALT } from "@/app/api/night-moments/[id]/alt-text/route";
import { __resetNightMemoryStore } from "@/lib/nightMemoryStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

const auth = (path: string, body?: unknown, token = "host") => new Request(`http://localhost${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Night Memory HTTP contract", () => {
  beforeEach(() => {
    __resetNightMemoryStore();
    __resetMemoryProfiles();
  });

  it("requires an account and creates only a private Memory", async () => {
    const denied = await CREATE_MEMORY(new Request("http://localhost/api/night-memories", { method: "POST", body: "{}" }));
    expect(denied.status).toBe(401);

    const created = await CREATE_MEMORY(auth("/api/night-memories", { title: "Friday orbit", visibility: "public" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ memory: { ownerId: "host", visibility: "private" } });

    const list = await LIST_MEMORIES(auth("/api/night-memories"));
    expect((await list.json()).memories).toHaveLength(1);
  });

  it("does not accept a client-supplied Plan completion link without an ownership binding", async () => {
    const response = await CREATE_MEMORY(auth("/api/night-memories", {
      title: "Friday orbit",
      planCompletionId: crypto.randomUUID(),
    }));
    expect(response.status).toBe(400);
  });

  it("publishes via a typed proposal followed by token confirmation", async () => {
    const memoryResponse = await CREATE_MEMORY(auth("/api/night-memories", { title: "Friday orbit" }));
    const { memory } = await memoryResponse.json();
    const momentResponse = await ADD_MEMORY_MOMENT(auth(`/api/night-memories/${memory.id}/moments`, { kind: "quote", caption: "One more side quest" }), ctx(memory.id));
    const { moment } = await momentResponse.json();
    const storyResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Friday orbit" }));
    const { story } = await storyResponse.json();

    const listedMoments = await LIST_MOMENTS(auth(`/api/night-memories/${memory.id}/moments`), ctx(memory.id));
    expect((await listedMoments.json()).moments).toEqual([expect.objectContaining({ id: moment.id, visibility: "private" })]);
    const listedStories = await LIST_STORIES(auth("/api/night-stories"));
    expect((await listedStories.json()).stories).toEqual([expect.objectContaining({ id: story.id, status: "draft" })]);

    expect((await GET_STORY(new Request(`http://localhost/api/night-stories/${story.id}`), ctx(story.id))).status).toBe(404);
    const proposalResponse = await PROPOSE(auth(`/api/night-stories/${story.id}/publish-proposals`, { momentIds: [moment.id], visibility: "public" }), ctx(story.id));
    expect(proposalResponse.status).toBe(201);
    const proposal = await proposalResponse.json();
    expect(proposal).toMatchObject({ proposal: { storyId: story.id, visibility: "public" } });

    const confirmed = await CONFIRM(auth(`/api/night-stories/${story.id}/publish-confirmations`, {
      proposalId: proposal.proposal.id,
      confirmationToken: proposal.confirmationToken,
    }), ctx(story.id));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ story: { status: "published", visibility: "public" } });
    const publicResponse = await GET_STORY(new Request(`http://localhost/api/night-stories/${story.id}`), ctx(story.id));
    expect(publicResponse.status).toBe(200);
    const publicBody = await publicResponse.json();
    expect(publicBody.story).not.toHaveProperty("memoryId");
    expect(publicBody.story).not.toHaveProperty("hostEditorId");
  });

  it("refuses to publish a photo lacking confirmed alt text, names it, then unblocks once the owner describes it", async () => {
    const memoryResponse = await CREATE_MEMORY(auth("/api/night-memories", { title: "Rooftop" }));
    const { memory } = await memoryResponse.json();
    // A private photo save with no description succeeds (gate is publication-only).
    const momentResponse = await ADD_MEMORY_MOMENT(auth(`/api/night-memories/${memory.id}/moments`, { kind: "photo", caption: "The rooftop at midnight", mediaObjectKey: "night-media/host/r.webp" }), ctx(memory.id));
    expect(momentResponse.status).toBe(201);
    const { moment } = await momentResponse.json();
    const storyResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Rooftop" }));
    const { story } = await storyResponse.json();

    const blocked = await PROPOSE(auth(`/api/night-stories/${story.id}/publish-proposals`, { momentIds: [moment.id], visibility: "public" }), ctx(story.id));
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json();
    expect(blockedBody).toMatchObject({ code: "MOMENT_ALT_TEXT_REQUIRED", momentId: moment.id });
    expect(blockedBody.error).toContain("The rooftop at midnight");

    // Only the owner may describe the photo.
    const strangerPatch = new Request(`http://localhost/api/night-moments/${moment.id}/alt-text`, {
      method: "PATCH",
      headers: { authorization: "Bearer stranger", "content-type": "application/json" },
      body: JSON.stringify({ altText: "Sneaky" }),
    });
    expect((await SET_ALT(strangerPatch, ctx(moment.id))).status).toBe(403);

    const ownerPatch = new Request(`http://localhost/api/night-moments/${moment.id}/alt-text`, {
      method: "PATCH",
      headers: { authorization: "Bearer host", "content-type": "application/json" },
      body: JSON.stringify({ altText: "A rooftop bar lit by string lights." }),
    });
    const described = await SET_ALT(ownerPatch, ctx(moment.id));
    expect(described.status).toBe(200);
    const describedBody = await described.json();
    expect(describedBody).toMatchObject({ altTextConfirmed: true });
    expect(JSON.stringify(describedBody)).not.toContain('"ownerId"');

    const proposalResponse = await PROPOSE(auth(`/api/night-stories/${story.id}/publish-proposals`, { momentIds: [moment.id], visibility: "public" }), ctx(story.id));
    expect(proposalResponse.status).toBe(201);
  });

  it("edits and previews a private Story without exposing account identifiers", async () => {
    const memoryResponse = await CREATE_MEMORY(auth("/api/night-memories", { title: "Friday orbit" }));
    const { memory } = await memoryResponse.json();
    await ADD_MEMORY_MOMENT(auth(`/api/night-memories/${memory.id}/moments`, { kind: "venue", caption: "Approved private line", venueId: "venue-a" }), ctx(memory.id));
    const storyResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Draft title" }));
    const { story } = await storyResponse.json();

    const updated = await UPDATE_STORY(auth(`/api/night-stories/${story.id}`, { title: "Edited title", summary: "Edited opening" }), ctx(story.id));
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(updatedBody).toMatchObject({ story: { title: "Edited title", status: "draft", visibility: "private" } });
    expect(updatedBody.story).not.toHaveProperty("hostEditorId");
    expect(updatedBody.story).not.toHaveProperty("memoryId");

    const workspace = await GET_STORY_WORKSPACE(auth(`/api/night-stories/${story.id}/workspace`), ctx(story.id));
    expect(workspace.status).toBe(200);
    const body = await workspace.json();
    expect(body).toMatchObject({
      story: { id: story.id, title: "Edited title" },
      moments: [expect.objectContaining({ caption: "Approved private line", ownedByCaller: true, consent: "pending" })],
      caller: { role: "host", canEdit: true },
    });
    expect(JSON.stringify(body)).not.toContain('"ownerId"');
    expect(JSON.stringify(body)).not.toContain('"profileId"');
    expect(JSON.stringify(body)).not.toContain('"hostEditorId"');
    expect(JSON.stringify(body)).not.toContain('"memoryId"');
    const forbiddenWorkspace = await GET_STORY_WORKSPACE(auth(`/api/night-stories/${story.id}/workspace`, undefined, "stranger"), ctx(story.id));
    expect(forbiddenWorkspace.status).toBe(403);
    expect(await forbiddenWorkspace.json()).toMatchObject({ code: "STORY_WORKSPACE_FORBIDDEN", retryable: false });
  });

  it("lets a non-host discover, accept, contribute, and consent without edit capability", async () => {
    await profileStore().createOwned("friend", "friend-user");
    const memoryResponse = await CREATE_MEMORY(auth("/api/night-memories", { title: "Crew night" }));
    const { memory } = await memoryResponse.json();
    const storyResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Crew night" }));
    const { story } = await storyResponse.json();
    expect((await INVITE_CONTRIBUTOR(auth(`/api/night-stories/${story.id}/contributors`, { handle: "friend", role: "contributor" }), ctx(story.id))).status).toBe(201);

    const invitedList = await LIST_STORIES(auth("/api/night-stories", undefined, "friend-user"));
    const invitedBody = await invitedList.json();
    expect(invitedBody.stories).toHaveLength(1);
    expect(invitedBody.stories[0]).toMatchObject({ id: story.id, membership: { role: "contributor", status: "invited" } });
    expect((await GET_STORY_WORKSPACE(auth(`/api/night-stories/${story.id}/workspace`, undefined, "friend-user"), ctx(story.id))).status).toBe(403);
    expect((await ACCEPT_CONTRIBUTOR(auth(`/api/night-stories/${story.id}/contributors`, {}, "friend-user"), ctx(story.id))).status).toBe(200);
    const replayedAccept = await ACCEPT_CONTRIBUTOR(auth(`/api/night-stories/${story.id}/contributors`, {}, "friend-user"), ctx(story.id));
    expect(replayedAccept.status).toBe(404);
    expect(await replayedAccept.json()).toMatchObject({ code: "STORY_INVITATION_NOT_FOUND", retryable: false });

    const momentResponse = await ADD_STORY_MOMENT(auth(`/api/night-stories/${story.id}/moments`, { kind: "quote", caption: "Friend-approved line" }, "friend-user"), ctx(story.id));
    expect(momentResponse.status).toBe(201);
    const { moment } = await momentResponse.json();
    const friendWorkspace = await GET_STORY_WORKSPACE(auth(`/api/night-stories/${story.id}/workspace`, undefined, "friend-user"), ctx(story.id));
    expect(await friendWorkspace.json()).toMatchObject({ caller: { role: "contributor", canEdit: false }, moments: [expect.objectContaining({ id: moment.id, ownedByCaller: true })] });
    expect((await SET_STORY_CONSENT(auth(`/api/night-stories/${story.id}/consents`, { momentId: moment.id, status: "approved" }, "friend-user"), ctx(story.id))).status).toBe(200);
    const hostWorkspace = await GET_STORY_WORKSPACE(auth(`/api/night-stories/${story.id}/workspace`), ctx(story.id));
    expect(await hostWorkspace.json()).toMatchObject({ moments: [expect.objectContaining({ caption: "Friend-approved line", consent: "approved" })] });

    const secondStoryResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Declined story" }));
    const { story: secondStory } = await secondStoryResponse.json();
    await INVITE_CONTRIBUTOR(auth(`/api/night-stories/${secondStory.id}/contributors`, { handle: "friend" }), ctx(secondStory.id));
    expect((await DECLINE_CONTRIBUTOR(auth(`/api/night-stories/${secondStory.id}/contributors`, undefined, "friend-user"), ctx(secondStory.id))).status).toBe(200);
    expect((await DECLINE_CONTRIBUTOR(auth(`/api/night-stories/${secondStory.id}/contributors`, undefined, "friend-user"), ctx(secondStory.id))).status).toBe(404);
    const afterDecline = await LIST_STORIES(auth("/api/night-stories", undefined, "friend-user"));
    expect((await afterDecline.json()).stories.map((item: { id: string }) => item.id)).not.toContain(secondStory.id);
  });
});
