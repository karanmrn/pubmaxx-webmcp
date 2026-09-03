// One cover in the rotation.
//
//   PATCH { move: "up" | "down" } -> 200 { profile, covers }
//   DELETE                        -> 200 { profile, covers }
//
// Thin over `lib/profileCoverPhotoRoute.server.ts`, which owns the per-actor
// budget, the ownership gate and the storage cleanup.

import {
  handleProfileCoverPhotoDelete,
  handleProfileCoverPhotoMove,
} from "@/lib/profileCoverPhotoRoute.server";
import { profileCoverPhotoRouteDeps } from "@/lib/profileCoverPhotoRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ handle: string; coverId: string }> };

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { handle, coverId } = await params;
  return handleProfileCoverPhotoMove(request, handle, coverId);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const { handle, coverId } = await params;
  return handleProfileCoverPhotoDelete(request, handle, coverId, profileCoverPhotoRouteDeps());
}
