// Reader report lane for the owned profile avatar (Social Launch WP4).
//
//   POST { reason? } -> 200 { ok: true }
//
// The rules live in lib/profileImageRoute.server.ts, shared with the cover.

import { handleProfileImageReport } from "@/lib/profileImageRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ handle: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageReport(request, (await context.params).handle, "avatar");
}
