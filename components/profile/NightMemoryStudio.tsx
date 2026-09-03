"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Eye, LockKeyhole, UserPlus } from "lucide-react";

import "./NightMemoryStudio.css";

import { trackEvent, trackMeaningfulCoreAction } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { NightMomentKind } from "@/lib/nightMemory";
import {
  readMemoryStudioDraft,
  subscribeMemoryStudioDraft,
  writeMemoryStudioDraft,
  type MemoryStudioDraft,
} from "@/lib/socialDrafts";

type Memory = { id: string; title: string; createdAt: string };
type Moment = { id: string; kind: NightMomentKind; caption: string; venueId: string | null; createdAt: string };
type Story = { id: string; memoryId?: string; title: string; summary: string; status: "draft" | "published"; visibility: string; publishedMomentIds?: string[]; membership?: { role: "host" | "editor" | "contributor"; status: "invited" | "accepted" | "removed"; joinedAt: string | null } };
type StoryWorkspace = {
  story: Story;
  moments: Array<{ id: string; kind: NightMomentKind; caption: string; venueId: string | null; occurredAt: string | null; ownedByCaller: boolean; consent: "pending" | "approved" | "withdrawn"; hasPhoto: boolean; altText: string | null; altTextConfirmed: boolean }>;
  contributors: Array<{ handle: string | null; role: "host" | "editor" | "contributor"; status: "invited" | "accepted" | "removed"; joinedAt: string | null }>;
  caller: { role: "host" | "editor" | "contributor"; canEdit: boolean };
};
type PublicationConfirmation = { storyId: string; proposalId: string; confirmationToken: string; visibility: "public" | "unlisted"; momentCount: number; revision: number };

const MOMENT_LABELS: Record<MemoryStudioDraft["momentKind"], string> = {
  event: "Event",
  venue: "Place",
  quote: "Quote",
  person: "Person",
  // Stored kind id stays side_quest; only the label follows the voice spec.
  side_quest: "Detour",
};

export default function NightMemoryStudio({ userId }: { userId: string }) {
  const [draft, setDraft] = useState<MemoryStudioDraft>(() => readMemoryStudioDraft(userId));
  const [memories, setMemories] = useState<Memory[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // True once the initial memories+stories fetch settles (success or error).
  // Gates the first-run onboarding callout so it never flickers during load.
  const [studioLoaded, setStudioLoaded] = useState(false);
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const [workspace, setWorkspace] = useState<StoryWorkspace | null>(null);
  const [selectedMomentIds, setSelectedMomentIds] = useState<string[]>([]);
  const [publishVisibility, setPublishVisibility] = useState<"public" | "unlisted">("unlisted");
  const [confirmation, setConfirmation] = useState<PublicationConfirmation | null>(null);
  const [inviteHandle, setInviteHandle] = useState("");
  // Per-photo alt-text drafts, keyed by moment id. Falls back to the saved value.
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [contributionDraft, setContributionDraft] = useState<{ kind: NightMomentKind; caption: string; venueId: string }>({
    kind: "quote",
    caption: "",
    venueId: "",
  });
  const selectedStoryIdRef = useRef("");
  const previewRevisionRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      authedActionFetch("/api/night-memories", { signal: controller.signal }),
      authedActionFetch("/api/night-stories", { signal: controller.signal }),
    ]).then(async ([memoryResponse, storyResponse]) => {
      if (controller.signal.aborted) return;
      const nextMemories = memoryResponse.ok
        ? ((await memoryResponse.json()) as { memories?: Memory[] }).memories ?? []
        : [];
      const nextStories = storyResponse.ok
        ? ((await storyResponse.json()) as { stories?: Story[] }).stories ?? []
        : [];
      setMemories(nextMemories);
      setStories(nextStories);
      setStudioLoaded(true);
      const current = selectedStoryIdRef.current;
      const nextStoryId = nextStories.some((story) => story.id === current && story.membership?.status !== "invited")
        ? current
        : (nextStories.find((story) => story.status === "draft" && story.membership?.status !== "invited")?.id
          ?? nextStories.find((story) => story.membership?.status !== "invited")?.id
          ?? "");
      selectedStoryIdRef.current = nextStoryId;
      setSelectedStoryId(nextStoryId);
      setDraft((current) => ({
        ...current,
        selectedMemoryId: nextMemories.some((item) => item.id === current.selectedMemoryId)
          ? current.selectedMemoryId
          : (nextMemories[0]?.id ?? ""),
      }));
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("Your Memory studio could not be loaded. Try again.");
        setStudioLoaded(true);
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    writeMemoryStudioDraft(userId, draft);
  }, [draft, userId]);

  useEffect(() => subscribeMemoryStudioDraft(userId, () => {
    setDraft(readMemoryStudioDraft(userId));
  }), [userId]);

  useEffect(() => {
    if (!draft.selectedMemoryId) {
      queueMicrotask(() => setMoments([]));
      return;
    }
    const controller = new AbortController();
    void authedActionFetch(`/api/night-memories/${encodeURIComponent(draft.selectedMemoryId)}/moments`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!controller.signal.aborted && response.ok) {
        setMoments(((await response.json()) as { moments?: Moment[] }).moments ?? []);
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [draft.selectedMemoryId]);

  useEffect(() => {
    if (!selectedStoryId) {
      queueMicrotask(() => setWorkspace(null));
      return;
    }
    const controller = new AbortController();
    void authedActionFetch(`/api/night-stories/${encodeURIComponent(selectedStoryId)}/workspace`, {
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as StoryWorkspace & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !body.story) {
        setWorkspace(null);
        setMessage(errorMessageFrom(body, "That Story preview could not be loaded."));
        return;
      }
      setWorkspace(body);
      setSelectedMomentIds(body.story.publishedMomentIds ?? []);
      setConfirmation(null);
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("That Story preview could not be loaded.");
    });
    return () => controller.abort();
  }, [selectedStoryId]);

  async function refreshWorkspace(storyId: string = selectedStoryId): Promise<boolean> {
    if (!storyId) return false;
    const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(storyId)}/workspace`);
    const body = await response.json().catch(() => ({})) as StoryWorkspace & { error?: string };
    if (!response.ok || !body.story) throw new Error(errorMessageFrom(body, "That Story preview could not be loaded."));
    if (selectedStoryIdRef.current !== storyId) return false;
    setWorkspace(body);
    setStories((current) => current.map((story) => story.id === body.story.id ? body.story : story));
    return true;
  }

  function update(patch: Partial<MemoryStudioDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function selectStory(storyId: string) {
    if (storyId === selectedStoryIdRef.current) return;
    selectedStoryIdRef.current = storyId;
    previewRevisionRef.current += 1;
    setSelectedStoryId(storyId);
    setWorkspace(null);
    setSelectedMomentIds([]);
    setConfirmation(null);
  }

  function invalidatePublication() {
    previewRevisionRef.current += 1;
    setConfirmation(null);
  }

  async function createMemory(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
      const response = await authedActionFetch("/api/night-memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: draft.memoryTitle }),
    });
    const body = await response.json().catch(() => ({})) as { memory?: Memory; error?: string };
    setSaving(false);
    if (!response.ok || !body.memory) return setMessage(errorMessageFrom(body, "Could not create that Memory."));
    setMemories((current) => [body.memory!, ...current]);
    update({ memoryTitle: "", selectedMemoryId: body.memory.id, storyTitle: body.memory.title });
    setMessage("Private Memory created. Add the parts worth keeping.");
  }

  async function addMoment(event: FormEvent) {
    event.preventDefault();
    if (!draft.selectedMemoryId) return setMessage("Create or choose a Memory first.");
    setSaving(true);
      const response = await authedActionFetch(`/api/night-memories/${encodeURIComponent(draft.selectedMemoryId)}/moments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: draft.momentKind,
        caption: draft.momentCaption,
        venueId: draft.venueId || null,
        occurredAt: new Date().toISOString(),
      }),
    });
    const body = await response.json().catch(() => ({})) as { moment?: Moment; error?: string };
    setSaving(false);
    if (!response.ok || !body.moment) return setMessage(errorMessageFrom(body, "Could not save that Moment."));
    setMoments((current) => [body.moment!, ...current]);
    update({ momentCaption: "", venueId: "" });
    trackEvent("night_moment_saved", { kind: body.moment.kind, visibility: "private" });
    setMessage("Moment saved privately.");
  }

  async function createStory(event: FormEvent) {
    event.preventDefault();
    if (!draft.selectedMemoryId) return setMessage("Choose a Memory before drafting its Story.");
    setSaving(true);
      const response = await authedActionFetch("/api/night-stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryId: draft.selectedMemoryId, title: draft.storyTitle, summary: draft.storySummary }),
    });
    const body = await response.json().catch(() => ({})) as { story?: Story; error?: string };
    setSaving(false);
    if (!response.ok || !body.story) return setMessage(errorMessageFrom(body, "Could not create that Story draft."));
    const ownedStory: Story = { ...body.story, membership: { role: "host", status: "accepted", joinedAt: null } };
    setStories((current) => [ownedStory, ...current]);
    selectStory(body.story.id);
    update({ storyTitle: "", storySummary: "" });
    setMessage("Story draft created. It remains private until you review and publish it.");
  }

  async function saveStoryPreview(event: FormEvent) {
    event.preventDefault();
    if (!workspace || workspace.story.status !== "draft") return;
    setSaving(true);
    setMessage("");
    const storyId = workspace.story.id;
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(storyId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: workspace.story.title, summary: workspace.story.summary }),
      });
      const body = await response.json().catch(() => ({})) as { story?: Story; error?: string };
      if (!response.ok || !body.story) throw new Error(errorMessageFrom(body, "That Story preview could not be saved."));
      if (selectedStoryIdRef.current !== storyId) return;
      setWorkspace((current) => current ? { ...current, story: body.story! } : current);
      setStories((current) => current.map((story) => story.id === body.story!.id ? body.story! : story));
      setConfirmation(null);
      setMessage("Story preview saved privately.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That Story preview could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function decideStoryInvitation(storyId: string, decision: "accept" | "decline") {
    setSaving(true);
    setMessage("");
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(storyId)}/contributors`, {
        method: decision === "accept" ? "PATCH" : "DELETE",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "That Story invitation could not be updated."));
      if (decision === "decline") {
        setStories((current) => current.filter((story) => story.id !== storyId));
        if (selectedStoryIdRef.current === storyId) selectStory("");
        setMessage("Story invitation declined.");
        return;
      }
      setStories((current) => current.map((story) => story.id === storyId
        ? { ...story, membership: { ...(story.membership ?? { role: "contributor", joinedAt: null }), status: "accepted" } }
        : story));
      if (selectedStoryIdRef.current !== storyId) selectStory(storyId);
      else await refreshWorkspace(storyId);
      setMessage("Story invitation accepted. You control which of your Moments may be included.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That Story invitation could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function setMomentConsent(momentId: string, status: "approved" | "withdrawn") {
    if (!workspace) return;
    setSaving(true);
    invalidatePublication();
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(workspace.story.id)}/consents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ momentId, status }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "That consent choice could not be saved."));
      if (!await refreshWorkspace(workspace.story.id)) return;
      if (status === "withdrawn") setSelectedMomentIds((current) => current.filter((id) => id !== momentId));
      setConfirmation(null);
      setMessage(status === "approved" ? "This Moment can be included in the proposed Story." : "Publication consent withdrawn.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That consent choice could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  // Author-confirm the alt text on the caller's OWN photo Moment. Saving their
  // typed words IS the confirmation (no AI provider in v1). A confirmed
  // description is what unblocks that photo for publication.
  async function saveMomentAltText(momentId: string) {
    if (!workspace) return;
    const altText = altDrafts[momentId] ?? "";
    setSaving(true);
    invalidatePublication();
    try {
      const response = await authedActionFetch(`/api/night-moments/${encodeURIComponent(momentId)}/alt-text`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ altText }),
      });
      const body = await response.json().catch(() => ({})) as { altTextConfirmed?: boolean; error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "That photo description could not be saved."));
      if (!await refreshWorkspace(workspace.story.id)) return;
      setMessage(body.altTextConfirmed
        ? "Photo description saved. This photo can now be published."
        : "Photo description cleared. Add one before publishing this photo.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That photo description could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addStoryContribution(event: FormEvent) {
    event.preventDefault();
    if (!workspace || workspace.caller.canEdit || workspace.story.status !== "draft") return;
    const storyId = workspace.story.id;
    setSaving(true);
    setMessage("");
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(storyId)}/moments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: contributionDraft.kind,
          caption: contributionDraft.caption,
          venueId: contributionDraft.venueId || null,
          occurredAt: new Date().toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({})) as { moment?: Moment; error?: string };
      if (!response.ok || !body.moment) throw new Error(errorMessageFrom(body, "That Moment could not be added to this Story."));
      if (!await refreshWorkspace(storyId)) return;
      setContributionDraft({ kind: "quote", caption: "", venueId: "" });
      setMessage("Moment added privately. Approve it below only when you are ready for the host to include it.");
      trackEvent("night_moment_saved", { kind: body.moment.kind, visibility: "private", source: "story_contribution" });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That Moment could not be added to this Story.");
    } finally {
      setSaving(false);
    }
  }

  async function inviteContributor(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !inviteHandle.trim()) return;
    setSaving(true);
    invalidatePublication();
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(workspace.story.id)}/contributors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: inviteHandle, role: "contributor" }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "That contributor could not be invited."));
      setInviteHandle("");
      if (!await refreshWorkspace(workspace.story.id)) return;
      setConfirmation(null);
      setMessage("Contributor invited. Their Moments still need their explicit publication consent.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That contributor could not be invited.");
    } finally {
      setSaving(false);
    }
  }

  async function proposePublication() {
    if (!workspace || selectedMomentIds.length === 0) return;
    setSaving(true);
    setMessage("");
    const storyId = workspace.story.id;
    const revision = previewRevisionRef.current;
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(storyId)}/publish-proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ momentIds: selectedMomentIds, visibility: publishVisibility }),
      });
      const body = await response.json().catch(() => ({})) as { proposal?: { id: string }; confirmationToken?: string; error?: string };
      if (!response.ok || !body.proposal || !body.confirmationToken) throw new Error(errorMessageFrom(body, "Every selected Moment needs current owner approval."));
      if (selectedStoryIdRef.current !== storyId || previewRevisionRef.current !== revision) return;
      setConfirmation({
        storyId,
        proposalId: body.proposal.id,
        confirmationToken: body.confirmationToken,
        visibility: publishVisibility,
        momentCount: selectedMomentIds.length,
        revision,
      });
      setMessage("Publication proposal is ready. Review the exact audience and confirm separately.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That publication proposal could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPublication() {
    if (!workspace || !confirmation || confirmation.storyId !== workspace.story.id || confirmation.revision !== previewRevisionRef.current) return;
    setSaving(true);
    try {
      const response = await authedActionFetch(`/api/night-stories/${encodeURIComponent(workspace.story.id)}/publish-confirmations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId: confirmation.proposalId, confirmationToken: confirmation.confirmationToken }),
      });
      const body = await response.json().catch(() => ({})) as { story?: Story; error?: string };
      if (!response.ok || !body.story) throw new Error(errorMessageFrom(body, "That Story could not be published."));
      setConfirmation(null);
      trackEvent("night_story_published", { contributors: workspace.contributors.length, moments: selectedMomentIds.length });
      trackEvent("story_published", { visibility: publishVisibility, contributors: workspace.contributors.length, moments: selectedMomentIds.length });
      trackMeaningfulCoreAction("story_published");
      if (!await refreshWorkspace(workspace.story.id)) return;
      setMessage("Story published here in Stories. Your private Memory remains private.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "That Story could not be published.");
    } finally {
      setSaving(false);
    }
  }

  const visibleStories = [
    ...stories.filter((story) => story.membership?.status === "invited"),
    ...stories.filter((story) => story.membership?.status !== "invited").slice(0, 8),
  ];

  return (
    <section className="memoryStudio" id="night-memories" aria-labelledby="memory-studio-title">
      <div className="memoryStudioHeader">
        <div>
          <p className="profileSectionKicker">Night Memory studio</p>
          <h3 id="memory-studio-title">Keep the parts you will tell people about.</h3>
        </div>
        <p>Everything starts private. A Story is a separate draft, never an automatic post.</p>
        <Link className="memoryCaptureLink" href="/moment">Save a Moment</Link>
      </div>

      {studioLoaded && memories.length === 0 && stories.length === 0 ? (
        <div className="memoryStudioFirstRun" role="status">
          <p className="memoryStudioFirstRunTitle">Your Memory studio is empty.</p>
          <p className="memoryStudioFirstRunBody">
            A Memory is a private night out in your words. Add the Moments worth keeping, then shape a Story you decide whether to share. Start below, or save tonight from the map.
          </p>
          <div className="memoryStudioFirstRunActions">
            <Link href="/moment" className="memoryStudioFirstRunPrimary">Save a Moment now</Link>
            <Link href="/map?log=1" className="memoryStudioFirstRunSecondary">Log a pint first</Link>
          </div>
        </div>
      ) : null}

      <div className="memoryStudioFlow">
        <form onSubmit={createMemory}>
          <span className="memoryStudioStep">1</span>
          <h4>Start a Memory</h4>
          <label><span>Name this night</span><input value={draft.memoryTitle} onChange={(event) => update({ memoryTitle: event.target.value })} maxLength={120} placeholder="Friday detour" required /></label>
          <button type="submit" disabled={saving}>Create private Memory</button>
        </form>

        <form onSubmit={addMoment}>
          <span className="memoryStudioStep">2</span>
          <h4>Add a Moment</h4>
          <label><span>Memory</span><select value={draft.selectedMemoryId} onChange={(event) => update({ selectedMemoryId: event.target.value })} required><option value="">Choose a Memory</option>{memories.map((memory) => <option value={memory.id} key={memory.id}>{memory.title}</option>)}</select></label>
          <label><span>Kind</span><select value={draft.momentKind} onChange={(event) => update({ momentKind: event.target.value as MemoryStudioDraft["momentKind"] })}>{Object.entries(MOMENT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>What happened?</span><textarea value={draft.momentCaption} onChange={(event) => update({ momentCaption: event.target.value })} maxLength={500} rows={3} placeholder="We followed the music and found a tiny basement set." required /></label>
          <label><span>Venue reference <small>optional</small></span><input value={draft.venueId} onChange={(event) => update({ venueId: event.target.value })} maxLength={80} placeholder="Venue ID or map reference" /></label>
          <button type="submit" disabled={saving || !draft.selectedMemoryId}>Save private Moment</button>
        </form>

        <form onSubmit={createStory}>
          <span className="memoryStudioStep">3</span>
          <h4>Shape the Story</h4>
          <label><span>Story title</span><input value={draft.storyTitle} onChange={(event) => update({ storyTitle: event.target.value })} maxLength={120} placeholder="The night we missed the last train" required /></label>
          <label><span>Opening line <small>optional</small></span><textarea value={draft.storySummary} onChange={(event) => update({ storySummary: event.target.value })} maxLength={500} rows={3} placeholder="A plan for two turned into a table of eight." /></label>
          <button type="submit" disabled={saving || !draft.selectedMemoryId}>Create private Story draft</button>
        </form>
      </div>

      <div className="memoryStudioShelf">
        <div><strong>{memories.length}</strong><span>Memories</span></div>
        <div><strong>{moments.length}</strong><span>Moments in this Memory</span></div>
        <div><strong>{stories.length}</strong><span>Stories</span></div>
      </div>
      {stories.length ? (
        <ul className="memoryStoryList" aria-label="Your Night Stories">
          {visibleStories.map((story) => (
            <li key={story.id} data-active={story.id === selectedStoryId ? "" : undefined}>
              <button className="memoryStoryList__select" type="button" onClick={() => selectStory(story.id)} aria-pressed={story.id === selectedStoryId} disabled={story.membership?.status === "invited"}>
                <span>{story.title}</span>
                <small>{story.membership?.status === "invited" ? "Consent invitation" : story.status === "draft" ? "Private draft" : story.visibility}</small>
              </button>
              {story.membership?.status === "invited" ? <div className="memoryStoryList__invite"><button type="button" disabled={saving} onClick={() => void decideStoryInvitation(story.id, "accept")}>Accept</button><button type="button" disabled={saving} onClick={() => void decideStoryInvitation(story.id, "decline")}>Decline</button></div> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {workspace ? (
        <section className="memoryStoryReview" aria-labelledby="story-review-title">
          <div className="memoryStoryReview__header">
            <div>
              <p className="profileSectionKicker">{workspace.caller.canEdit ? "Editable Story preview" : "Story consent preview"}</p>
              <h4 id="story-review-title">{workspace.caller.canEdit ? "Review what people will see." : "Control which of your Moments may appear."}</h4>
            </div>
            <span className="memoryStoryReview__privacy"><LockKeyhole size={15} aria-hidden="true" />{workspace.story.status === "draft" ? "Private until confirmed" : `Published · ${workspace.story.visibility}`}</span>
          </div>

          <form className="memoryStoryReview__copy" onSubmit={saveStoryPreview}>
            <label><span>Story title</span><input value={workspace.story.title} maxLength={120} disabled={workspace.story.status !== "draft" || !workspace.caller.canEdit || saving} onChange={(event) => { invalidatePublication(); setWorkspace((current) => current ? { ...current, story: { ...current.story, title: event.target.value } } : current); }} required /></label>
            <label><span>Opening line</span><textarea value={workspace.story.summary} maxLength={500} rows={3} disabled={workspace.story.status !== "draft" || !workspace.caller.canEdit || saving} onChange={(event) => { invalidatePublication(); setWorkspace((current) => current ? { ...current, story: { ...current.story, summary: event.target.value } } : current); }} /></label>
            {workspace.story.status === "draft" && workspace.caller.canEdit ? <button type="submit" disabled={saving}>Save private preview</button> : null}
          </form>

          {workspace.story.status === "draft" && !workspace.caller.canEdit ? (
            <form className="memoryStoryReview__contribution" onSubmit={addStoryContribution}>
              <div>
                <strong>Add one of your Moments</strong>
                <p>It stays private until you approve it below. The host cannot publish it without your current consent.</p>
              </div>
              <label><span>Kind</span><select value={contributionDraft.kind} disabled={saving} onChange={(event) => setContributionDraft((current) => ({ ...current, kind: event.target.value as NightMomentKind }))}>{Object.entries(MOMENT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>What happened?</span><textarea value={contributionDraft.caption} disabled={saving} onChange={(event) => setContributionDraft((current) => ({ ...current, caption: event.target.value }))} maxLength={500} rows={3} placeholder="The line or moment you want the host to consider." required /></label>
              <label><span>Venue reference <small>optional</small></span><input value={contributionDraft.venueId} disabled={saving} onChange={(event) => setContributionDraft((current) => ({ ...current, venueId: event.target.value }))} maxLength={80} placeholder="Venue ID or map reference" /></label>
              <button type="submit" disabled={saving || !contributionDraft.caption.trim()}>Add private Moment</button>
            </form>
          ) : null}

          <div className="memoryStoryReview__moments">
            <div><strong>Choose approved Moments</strong><span>{selectedMomentIds.length} selected</span></div>
            {workspace.moments.length ? (
              <ul>
                {workspace.moments.map((moment) => {
                  const canSelect = moment.ownedByCaller || moment.consent === "approved";
                  return (
                    <li key={moment.id}>
                      <label>
                        {workspace.caller.canEdit ? <input type="checkbox" checked={selectedMomentIds.includes(moment.id)} disabled={!canSelect || workspace.story.status !== "draft" || saving} onChange={(event) => { invalidatePublication(); setSelectedMomentIds((current) => event.target.checked ? [...new Set([...current, moment.id])] : current.filter((id) => id !== moment.id)); }} /> : null}
                        <span><strong>{moment.caption || moment.venueId || moment.kind}</strong><small>{moment.ownedByCaller ? "Your private Moment" : moment.consent === "approved" ? "Contributor approved" : "Waiting for contributor approval"}</small></span>
                      </label>
                      {moment.ownedByCaller && workspace.story.status === "draft" ? (
                        <button type="button" disabled={saving} onClick={() => void setMomentConsent(moment.id, moment.consent === "approved" ? "withdrawn" : "approved")}>
                          {moment.consent === "approved" ? "Withdraw approval" : "Approve for Story"}
                        </button>
                      ) : null}
                      {moment.ownedByCaller && moment.hasPhoto ? (
                        <div className="memoryMomentAlt">
                          <label>
                            <span>
                              Photo description
                              {moment.altTextConfirmed
                                ? <small className="memoryMomentAlt__ok"> · confirmed</small>
                                : <small className="memoryMomentAlt__todo"> · needed to publish</small>}
                            </span>
                            {/* AI-suggestion seam (v1: none): a provider could prefill
                                this for the author to edit and save. It must never
                                auto-fill or auto-confirm — the saved words are the
                                author confirmation the publish gate requires. */}
                            <textarea
                              value={altDrafts[moment.id] ?? moment.altText ?? ""}
                              onChange={(event) => setAltDrafts((current) => ({ ...current, [moment.id]: event.target.value }))}
                              maxLength={200}
                              rows={2}
                              disabled={saving}
                              placeholder="Describe the photo for someone who cannot see it."
                            />
                          </label>
                          <button type="button" disabled={saving} onClick={() => void saveMomentAltText(moment.id)}>Save description</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p>{workspace.caller.canEdit ? "Add a private Moment before shaping this Story." : "Add your first private Moment above, then choose whether to approve it."}</p>}
          </div>

          {workspace.story.status === "draft" && workspace.caller.canEdit ? (
            <div className="memoryStoryReview__controls">
              <form onSubmit={inviteContributor}>
                <label><span><UserPlus size={15} aria-hidden="true" />Invite affected contributor</span><input value={inviteHandle} onChange={(event) => setInviteHandle(event.target.value)} placeholder="PUBMAXX handle" maxLength={30} /></label>
                <button type="submit" disabled={saving || !inviteHandle.trim()}>Invite</button>
              </form>
              <div className="memoryStoryReview__publish">
                <label><span>Audience</span><select value={publishVisibility} disabled={saving} onChange={(event) => { setPublishVisibility(event.target.value as "public" | "unlisted"); invalidatePublication(); }}><option value="unlisted">Anyone with the link</option><option value="public">Public in Stories</option></select></label>
                <button type="button" disabled={saving || selectedMomentIds.length === 0} onClick={() => void proposePublication()}><Eye size={15} aria-hidden="true" />Review publication</button>
              </div>
            </div>
          ) : null}

          {confirmation ? (
            <div className="memoryStoryReview__confirmation" role="group" aria-label="Confirm Story publication">
              <Check size={18} aria-hidden="true" />
              <div><strong>Publish {confirmation.momentCount} Moment{confirmation.momentCount === 1 ? "" : "s"}?</strong><p>{confirmation.visibility === "public" ? "This Story will appear publicly in Stories." : "Only people with its link will be able to open it."} Consent is checked again when you confirm.</p></div>
              <button type="button" disabled={saving} onClick={() => void confirmPublication()}>{saving ? "Confirming…" : "Confirm publication"}</button>
              <button type="button" className="memoryStoryReview__cancel" onClick={() => setConfirmation(null)}>Cancel</button>
            </div>
          ) : null}
        </section>
      ) : null}
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
