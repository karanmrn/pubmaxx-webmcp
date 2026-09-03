// Durable saved-pub LISTS for a handle (cc_plan2 §5).
//   GET  ?handle=<handle>  (or ?actor=<anonId>)  → { saved: SavedPubDTO[] }
//   POST { handle, venueId, listType, note }      → { saved: SavedPubDTO[] }  (toggles)
//
// A save is filed under a self-asserted `handle` (no auth yet): the durable store
// bootstraps a profile row for that handle and keys saves by its profile_id
// (public.saved_pubs — see lib/savedPubsStore.ts). The response DTOs carry the
// resolved venue NAME + "open on the map" url (server-side via lib/venueIndex) so
// the profile never renders a raw "venue-…" id.
//
// Store choice is the usual seam: Supabase when configured, process-memory
// otherwise. Reads NEVER 503 — a saved-pubs outage degrades to an empty list, so
// the profile page always renders. The client keeps a localStorage fallback for a
// signed-out/offline viewer (lib/savedPubs.ts), so this route only ever augments
// the demo, never gates it.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { isLimited } from "@/lib/pintDrops";
import { isListTypeEligibleForVenue } from "@/lib/savedListPolicy";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  cleanListType,
  cleanNote,
  savedListsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { resolveVenue } from "@/lib/venueIndex";

assertServerEnv();

// venue ids are content-hashed (e.g. "venue-1ufn31x"); cap and trim, never trust
// the raw client length.
const MAX_VENUE_ID = 64;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const handle = normalizeHandle(params.get("handle") ?? "");
  const actor = readString(params.get("actor"));

  // ?lists=1 → the handle's custom list menu (story 33). Built-ins are known to
  // the client; this returns only the handle's OWN custom lists. Fail-soft → [].
  if (params.get("lists")) {
    const lists = handle ? await savedListsStore().listCustom(handle) : [];
    return jsonNoStore({ lists }, { status: 200 });
  }

  // Nothing to key on → an empty (but valid) list, so the page still renders.
  if (!handle && !actor) return jsonNoStore({ saved: [] }, { status: 200 });

  // listSaved is fail-soft (returns [] on any store error), so a saved-pubs
  // outage can never surface as a 500 that breaks the profile page.
  const saved = await savedPubsStore().listSaved({
    handle: handle || undefined,
    actorHash: actor ? hashActor(actor) : undefined,
  });
  return jsonNoStore({ saved }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) return publicApiError("Add a contributor handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // createList action (story 33): register a custom list name for this handle so
  // it appears in the pick-UI before it has any saves. Rate-limited like saves.
  if (readString(body.action) === "createList") {
    const name = cleanListType(body.name ?? body.listType);
    if (!name) return publicApiError("Add a list name.", "INVALID_REQUEST", 400);
    if (await isLimited(`lists:${ownership.handle}`, `lists:${hashIp(clientIp(request))}`)) {
      return publicApiError("Too many lists, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const lists = await savedListsStore().createList(ownership.handle, name);
    return jsonNoStore({ lists }, { status: 200 });
  }

  const venueId = (readString(body.venueId) ?? "").slice(0, MAX_VENUE_ID);
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);

  const listType = cleanListType(body.listType);
  if (!listType) {
    return publicApiError("Add a list name.", "INVALID_REQUEST", 400);
  }
  const venue = await resolveVenue(venueId);
  if (!isListTypeEligibleForVenue(listType, venue?.kind)) {
    return publicApiError("Choose a list that matches this venue.", "INVALID_REQUEST", 400);
  }

  // Note is untrusted free text: strip HTML/control chars and cap length.
  const note = cleanNote(body.note);

  // Rate-limit per handle AND per actor: the in-memory key leads with the handle
  // so one handle can't flood; the durable key leads with the actor (hashed IP)
  // so one device can't spam across handles. 429 when either budget is exhausted.
  const actorHash = hashIp(clientIp(request));
  if (await isLimited(`saved:${ownership.handle}`, `saved:${actorHash}`)) {
    return publicApiError("Too many saves, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // toggleSaved is fail-soft: a store error returns the current list unchanged, so
  // the client keeps its localStorage fallback in play rather than seeing a 503.
  const saved = await savedPubsStore().toggleSaved({
    handle: ownership.handle,
    venueId,
    listType,
    ...(note ? { note } : {}),
  });
  return jsonNoStore({ saved }, { status: 200 });
}
