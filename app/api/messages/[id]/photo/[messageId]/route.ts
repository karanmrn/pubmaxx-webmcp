// GET /api/messages/[id]/photo/[messageId] - the bytes of one message photo.
//
// It lives UNDER the conversation on purpose: the address itself says which
// courtesy check owns it. The gate, the refusal and the no-store posture are
// `lib/messagePhotoServe.server.ts`.

import {
  handleMessagePhotoServe,
} from "@/lib/messagePhotoServe.server";
import { messagePhotoServeRouteDeps } from "@/lib/messagePhotoServeRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ id: string; messageId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleMessagePhotoServe(request, await context.params, messagePhotoServeRouteDeps());
}
