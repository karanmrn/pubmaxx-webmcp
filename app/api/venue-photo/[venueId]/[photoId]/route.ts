import { assertServerEnv } from "@/lib/serverEnv";
import { handleVenuePhotoServe } from "@/lib/venuePhotoServe.server";
import { venuePhotoServeRouteDeps } from "@/lib/venuePhotoServeRouteDeps.server";

assertServerEnv();

type RouteContext = { params: Promise<{ venueId: string; photoId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleVenuePhotoServe(request, await context.params, venuePhotoServeRouteDeps());
}
