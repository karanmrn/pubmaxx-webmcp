// Reader report lane for ONE cover photo in the rotation.
//
//   POST { reason? } -> 200 { ok: true }
//
// A flag queues that photo for a human. It never auto-hides, never deletes, and
// never touches the other four.

import { handleProfileCoverPhotoReport } from "@/lib/profileCoverPhotoRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ handle: string; coverId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { handle, coverId } = await context.params;
  return handleProfileCoverPhotoReport(request, handle, coverId);
}
