import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_COMMENT_DRAFT,
  EMPTY_MEMORY_STUDIO_DRAFT,
  readCommentDraft,
  readMemoryStudioDraft,
  validateCommentDraft,
  validateMemoryStudioDraft,
  writeCommentDraft,
  writeMemoryStudioDraft,
} from "@/lib/socialDrafts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("versioned social draft session adapters", () => {
  beforeEach(() => {
    (globalThis as { window?: { sessionStorage: Storage; localStorage: Storage } }).window = {
      sessionStorage: memoryStorage(),
      localStorage: memoryStorage(),
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips a bounded Memory, Moment caption, and Story draft", () => {
    const draft = {
      ...EMPTY_MEMORY_STUDIO_DRAFT,
      selectedMemoryId: "memory-1",
      momentCaption: "The basement band started at midnight.",
      storyTitle: "The last train story",
      storySummary: "One approved opening line.",
    };
    writeMemoryStudioDraft("user-1", draft);
    expect(readMemoryStudioDraft("user-1")).toEqual(draft);
    expect(window.localStorage.getItem("pubmaxx.memory-studio.v1:user-1")).toContain('"version":1');
  });

  it("round-trips comment and reply drafts but removes an empty draft", () => {
    writeCommentDraft("drop-1", { body: "Save this thought", replyTo: "comment-1", replyBody: "And this reply" });
    expect(readCommentDraft("drop-1")).toEqual({ body: "Save this thought", replyTo: "comment-1", replyBody: "And this reply" });
    writeCommentDraft("drop-1", EMPTY_COMMENT_DRAFT);
    expect(readCommentDraft("drop-1")).toEqual(EMPTY_COMMENT_DRAFT);
    expect(window.localStorage.length).toBe(0);
  });

  it("rejects malformed or oversized payloads", () => {
    expect(validateMemoryStudioDraft({ ...EMPTY_MEMORY_STUDIO_DRAFT, momentKind: "secret" })).toBeNull();
    expect(validateMemoryStudioDraft({ ...EMPTY_MEMORY_STUDIO_DRAFT, storySummary: "x".repeat(501) })).toBeNull();
    expect(validateCommentDraft({ body: "x".repeat(501), replyTo: null, replyBody: "" })).toBeNull();
    window.localStorage.setItem("pubmaxx.comment-draft.v1:drop-2", JSON.stringify({ version: 2, draft: { body: "stale" } }));
    expect(readCommentDraft("drop-2")).toEqual(EMPTY_COMMENT_DRAFT);
  });

  it("migrates the previous versioned session drafts once", () => {
    const legacy = { ...EMPTY_MEMORY_STUDIO_DRAFT, memoryTitle: "Recovered night" };
    window.sessionStorage.setItem("pubmaxx.memory-studio.v1:user-1", JSON.stringify({ version: 1, savedAt: new Date(0).toISOString(), draft: legacy }));
    window.sessionStorage.setItem("pubmaxx.comment-draft.v1:drop-1", JSON.stringify({ version: 1, savedAt: new Date(0).toISOString(), draft: { body: "Recovered comment", replyTo: null, replyBody: "" } }));
    expect(readMemoryStudioDraft("user-1")).toEqual(legacy);
    expect(readCommentDraft("drop-1")).toMatchObject({ body: "Recovered comment" });
    expect(window.sessionStorage.getItem("pubmaxx.memory-studio.v1:user-1")).toBeNull();
    expect(window.sessionStorage.getItem("pubmaxx.comment-draft.v1:drop-1")).toBeNull();
    expect(window.localStorage.getItem("pubmaxx.memory-studio.v1:user-1")).toContain("Recovered night");
    expect(window.localStorage.getItem("pubmaxx.comment-draft.v1:drop-1")).toContain("Recovered comment");
  });
});
