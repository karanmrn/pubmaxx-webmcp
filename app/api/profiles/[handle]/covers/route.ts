// The owner's cover ROTATION: up to five backdrops that take turns behind a
// name.
//
//   GET  -> 200 { status, covers }                (owner)
//   POST multipart { photo } -> 201 { profile, covers }
//
// Thin over `lib/profileCoverPhotoRoute.server.ts`, exactly as the single-cover
// route is thin over `lib/profileImageRoute.server.ts`: the per-actor budget,
// the cap and the whole staging journey live there.

import {
  handleProfileCoverPhotoList,
  handleProfileCoverPhotoUpload,
} from "@/lib/profileCoverPhotoRoute.server";
import { profileCoverPhotosRouteDeps } from "@/lib/profileCoverPhotoRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const maxDuration = 15;

type RouteContext = { params: Promise<{ handle: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return handleProfileCoverPhotoList(request, (await params).handle);
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return handleProfileCoverPhotoUpload(
    request,
    (await params).handle,
    profileCoverPhotosRouteDeps(),
  );
}
