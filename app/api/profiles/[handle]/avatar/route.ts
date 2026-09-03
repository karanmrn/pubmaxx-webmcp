// The owner's face. Journey, ownership gate, budget, and copy live in
// lib/profileImageRoute.server.ts, shared verbatim with the cover slot.

import {
  handleProfileImageDelete,
  handleProfileImageUpload,
} from "@/lib/profileImageRoute.server";
import { profileAvatarRouteDeps } from "@/lib/profileImageRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageUpload(request, (await params).handle, "avatar", profileAvatarRouteDeps());
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageDelete(request, (await params).handle, "avatar", profileAvatarRouteDeps());
}
