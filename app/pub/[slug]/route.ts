import { venuePermalinkRedirect } from "@/lib/venuePermalinkRedirect";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return venuePermalinkRedirect(request, context);
}
