// The owner's backdrop. Same journey as the face — staging, scan, promote,
// tombstone-safe cleanup — through the one shared handler pair.

import {
  handleProfileImageDelete,
  handleProfileImageUpload,
} from "@/lib/profileImageRoute.server";
import { profileCoverRouteDeps } from "@/lib/profileImageRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageUpload(request, (await params).handle, "cover", profileCoverRouteDeps());
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return handleProfileImageDelete(request, (await params).handle, "cover", profileCoverRouteDeps());
}
