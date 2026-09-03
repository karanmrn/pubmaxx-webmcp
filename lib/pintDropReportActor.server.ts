import "server-only";

// WHO reported a Pint Drop is decided HERE, by the server, and never by the
// caller.
//
// Reporting remains public. A verified account report counts toward automatic
// hiding and is deduplicated by account. An anonymous report is recorded under
// the salted IP identity for moderation and flood control, but it does not count
// toward automatic hiding. No client-supplied field decides either identity.

import { callerUserId } from "@/lib/authServer";
import type { PintDropReportIdentity } from "@/lib/pintDrops";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

/**
 * The identity a report is COUNTED under. Server-derived, always.
 */
export async function pintDropReportIdentity(
  request: Request,
): Promise<PintDropReportIdentity> {
  let userId: string | null = null;
  try {
    userId = await callerUserId(request);
  } catch {
    // An identity lookup we could not run is not a caller we may trust with
    // their own id: fall through to the request's own facts.
    userId = null;
  }
  return userId
    ? { kind: "verified_account", actorHash: hashActor(`user:${userId}`) }
    : {
        kind: "anonymous_ip",
        actorHash: hashActor(`ip:${hashIp(clientIp(request))}`),
      };
}
