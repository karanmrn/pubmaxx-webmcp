// Moderated import notes (Wave F3).
//   GET  → { notes: ImportNote[] }   (token-gated; queued by default)
//   POST { body, venueId?, venueName?, provenance } → { ok, note }
//   PATCH { id, action: "dismiss" | "restore" } → { ok, note? }
//
// Persists to .data/import-notes.json when the filesystem allows.
// No Reddit/X polling — staff-entered research notes only.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  dismissImportNote,
  enqueueImportNote,
  listImportNotes,
  restoreImportNote,
  validateImportNote,
} from "@/lib/importNotesStore";
import { isImportNotesLimited } from "@/lib/importNotesRateLimit";
import { assertServerEnv } from "@/lib/serverEnv";

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

export async function GET(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  const url = new URL(request.url);
  const includeDismissed = url.searchParams.get("includeDismissed") === "1";
  return jsonNoStore(
    { notes: listImportNotes({ includeDismissed }) },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  if (await isImportNotesLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const validated = validateImportNote(body);
  if (!validated.ok) {
    return publicApiError(validated.error, "INVALID_REQUEST", 400);
  }

  const note = enqueueImportNote(validated.note);
  return jsonNoStore(
    { ok: true, note, message: "Queued for review" },
    { status: 200 },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action;
  if (!id) return publicApiError("Note id is missing.", "INVALID_REQUEST", 400);
  if (action !== "dismiss" && action !== "restore") {
    return publicApiError("Action must be dismiss or restore.", "INVALID_REQUEST", 400);
  }

  const ok = action === "dismiss" ? dismissImportNote(id) : restoreImportNote(id);
  if (!ok) return publicApiError("Note not found.", "NOT_FOUND", 404);

  const notes = listImportNotes({ includeDismissed: true });
  const note = notes.find((n) => n.id === id) ?? null;
  return jsonNoStore(
    {
      ok: true,
      note,
      message: action === "dismiss" ? "Note dismissed." : "Note restored to queue.",
    },
    { status: 200 },
  );
}
