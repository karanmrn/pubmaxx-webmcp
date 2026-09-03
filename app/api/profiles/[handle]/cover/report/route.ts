// Reader report lane for the owned profile cover photo.
//
//   POST { reason? } -> 200 { ok: true }
//
// A flag queues the backdrop for a human. It never auto-hides and never deletes.

import { handleProfileImageReport } from "@/lib/profileImageRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ handle: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageReport(request, (await context.params).handle, "cover");
}
