// Create a Round (GH #26, PRD § The Spill — The Round is the group crawl that
// builds itself live).
//   POST { title?, handle } → 201 { round, members, stops }   (RoundState)
//
// Identity: prefer a verified Supabase Auth JWT when present — if the auth user
// has a linked profile, that handle is the actor (body handle is not trusted
// alone). When auth is absent / unconfigured / unlinked, the self-asserted
// handle still works (demo path), same as messages. The creator is the first
// member of their own Round. Store choice is the usual seam: Supabase when
// configured, process-memory otherwise. Writes are rate-limited per handle +
// hashed IP, like the app's other write routes.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { roundsStore } from "@/lib/roundsStore";
import { projectRoundView } from "@/lib/roundView.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return publicApiError("Add a handle to start a Round.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const key = `round-create:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many Rounds, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const result = await roundsStore().create({ title: body.title, createdByHandle: handle });
  if (!result.ok) {
    // A store failure is a degraded dependency (503, fail-soft), not a bug (500)
    // — the house contract every other write route uses (see pint-drops).
    const status = result.error === "invalid" ? 400 : 503;
    return publicApiErrorFromStatus("Could not start the Round.", status);
  }
  return jsonNoStore(await projectRoundView(request, result.state), {
    status: 201,
  });
}
