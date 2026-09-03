// Moderated import-note queue (Wave F3).
// Staff-entered research notes only — never polls Reddit/X.
// Persists to a JSON file under .data/ so notes survive process restarts in
// demo/dev. Falls back to in-memory when the filesystem is unavailable
// (read-only deploy, tests without a writable dir).

import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ImportNoteProvenance = "sourced" | "contributor";

export type ImportNoteStatus = "queued" | "dismissed";

export type ImportNote = {
  id: string;
  /** URL and/or free-text research note. */
  body: string;
  venueId: string | null;
  venueName: string | null;
  provenance: ImportNoteProvenance;
  status: ImportNoteStatus;
  createdAt: string;
  /** Set when a moderator dismisses the note. */
  dismissedAt?: string;
};

const MAX_BODY = 2000;
const MAX_VENUE = 120;
const MAX_QUEUE = 200;

const DEFAULT_PATH = join(process.cwd(), ".data", "import-notes.json");

type StoreFile = { version: 1; notes: ImportNote[] };

let memoryNotes: ImportNote[] = [];
let seq = 0;
let loaded = false;
let persistPath: string | null = DEFAULT_PATH;
let persistEnabled = true;

function nextId(): string {
  seq += 1;
  return `import-note-${Date.now().toString(36)}-${seq}`;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (!persistEnabled || !persistPath) return;
  try {
    if (!existsSync(/* turbopackIgnore: true */ persistPath)) return;
    const raw = readFileSync(
      /* turbopackIgnore: true */ persistPath,
      "utf8",
    );
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || !Array.isArray(parsed.notes)) return;
    memoryNotes = parsed.notes.filter(
      (n) =>
        n &&
        typeof n.id === "string" &&
        typeof n.body === "string" &&
        (n.status === "queued" || n.status === "dismissed"),
    );
  } catch {
    // Corrupt / unreadable file — start empty; next write will replace it.
    memoryNotes = [];
  }
}

function persist(): void {
  if (!persistEnabled || !persistPath) return;
  try {
    mkdirSync(
      /* turbopackIgnore: true */ dirname(persistPath),
      { recursive: true },
    );
    const body: StoreFile = { version: 1, notes: memoryNotes.slice(0, MAX_QUEUE) };
    writeFileSync(
      /* turbopackIgnore: true */ persistPath,
      `${JSON.stringify(body, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Read-only FS — keep serving from memory for this process.
  }
}

export type ImportNoteInput = {
  body: string;
  venueId?: string | null;
  venueName?: string | null;
  provenance: ImportNoteProvenance;
};

export type ImportNoteValidation =
  | { ok: true; note: ImportNoteInput }
  | { ok: false; error: string };

export function validateImportNote(raw: {
  body?: unknown;
  venueId?: unknown;
  venueName?: unknown;
  provenance?: unknown;
}): ImportNoteValidation {
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return { ok: false, error: "Add a URL or note." };
  if (body.length > MAX_BODY) {
    return { ok: false, error: `Note is too long (max ${MAX_BODY} characters).` };
  }

  const provenance = raw.provenance;
  if (provenance !== "sourced" && provenance !== "contributor") {
    return { ok: false, error: "Source type must be sourced or contributor." };
  }

  const venueId =
    typeof raw.venueId === "string" && raw.venueId.trim()
      ? raw.venueId.trim().slice(0, MAX_VENUE)
      : null;
  const venueName =
    typeof raw.venueName === "string" && raw.venueName.trim()
      ? raw.venueName.trim().slice(0, MAX_VENUE)
      : null;

  return {
    ok: true,
    note: { body, venueId, venueName, provenance },
  };
}

export function enqueueImportNote(input: ImportNoteInput): ImportNote {
  ensureLoaded();
  const note: ImportNote = {
    id: nextId(),
    body: input.body,
    venueId: input.venueId ?? null,
    venueName: input.venueName ?? null,
    provenance: input.provenance,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  memoryNotes.unshift(note);
  if (memoryNotes.length > MAX_QUEUE) memoryNotes.length = MAX_QUEUE;
  persist();
  return note;
}

/** Queued notes first (newest), then dismissed — for the admin review list. */
export function listImportNotes(opts?: { includeDismissed?: boolean }): ImportNote[] {
  ensureLoaded();
  const includeDismissed = opts?.includeDismissed === true;
  const notes = includeDismissed
    ? memoryNotes
    : memoryNotes.filter((n) => n.status === "queued");
  return [...notes];
}

/** Mark a note dismissed. Returns false if the id is unknown. */
export function dismissImportNote(id: string): boolean {
  ensureLoaded();
  const note = memoryNotes.find((n) => n.id === id);
  if (!note) return false;
  if (note.status === "dismissed") return true;
  note.status = "dismissed";
  note.dismissedAt = new Date().toISOString();
  persist();
  return true;
}

/** Re-queue a dismissed note (undo). Returns false if unknown. */
export function restoreImportNote(id: string): boolean {
  ensureLoaded();
  const note = memoryNotes.find((n) => n.id === id);
  if (!note) return false;
  note.status = "queued";
  delete note.dismissedAt;
  persist();
  return true;
}

/** Test helper — clears memory + optional custom persist path. */
export function resetImportNotesForTests(opts?: {
  persistPath?: string | null;
  persistEnabled?: boolean;
}): void {
  memoryNotes = [];
  seq = 0;
  loaded = false;
  if (opts && "persistPath" in opts) {
    persistPath = opts.persistPath ?? null;
  } else {
    persistPath = DEFAULT_PATH;
  }
  if (opts && "persistEnabled" in opts) {
    persistEnabled = opts.persistEnabled !== false;
  } else {
    persistEnabled = true;
  }
}

/** Test helper — force a reload from disk on next read. */
export function unloadImportNotesForTests(): void {
  loaded = false;
  memoryNotes = [];
}
