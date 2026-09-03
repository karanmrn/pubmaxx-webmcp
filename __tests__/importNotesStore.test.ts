import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  dismissImportNote,
  enqueueImportNote,
  listImportNotes,
  resetImportNotesForTests,
  restoreImportNote,
  unloadImportNotesForTests,
  validateImportNote,
} from "@/lib/importNotesStore";

describe("importNotesStore", () => {
  let tmpDir: string;
  let persistPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-notes-"));
    persistPath = join(tmpDir, "import-notes.json");
    resetImportNotesForTests({ persistPath, persistEnabled: true });
  });

  afterEach(() => {
    resetImportNotesForTests({ persistEnabled: false, persistPath: null });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects empty body and bad provenance", () => {
    expect(validateImportNote({ body: "  ", provenance: "sourced" }).ok).toBe(false);
    expect(validateImportNote({ body: "note", provenance: "demo" }).ok).toBe(false);
  });

  it("accepts a sourced URL note and queues it", () => {
    const validated = validateImportNote({
      body: "https://example.com/pub-history",
      venueId: "venue-abc",
      venueName: "The Example Arms",
      provenance: "sourced",
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const note = enqueueImportNote(validated.note);
    expect(note.status).toBe("queued");
    expect(listImportNotes()).toHaveLength(1);
    expect(listImportNotes()[0].body).toContain("example.com");
  });

  it("persists notes to disk and reloads after unload", () => {
    enqueueImportNote({
      body: "https://example.com/persist-me",
      provenance: "contributor",
    });
    expect(existsSync(persistPath)).toBe(true);
    const raw = JSON.parse(readFileSync(persistPath, "utf8")) as {
      notes: { body: string }[];
    };
    expect(raw.notes[0].body).toContain("persist-me");

    unloadImportNotesForTests();
    const reloaded = listImportNotes();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].body).toContain("persist-me");
  });

  it("dismisses and restores notes", () => {
    const note = enqueueImportNote({
      body: "dismiss me",
      provenance: "sourced",
    });
    expect(dismissImportNote(note.id)).toBe(true);
    expect(listImportNotes()).toHaveLength(0);
    expect(listImportNotes({ includeDismissed: true })).toHaveLength(1);
    expect(listImportNotes({ includeDismissed: true })[0].status).toBe("dismissed");

    expect(restoreImportNote(note.id)).toBe(true);
    expect(listImportNotes()).toHaveLength(1);
    expect(listImportNotes()[0].status).toBe("queued");
  });
});
