import { notFound } from "next/navigation";
import { NextResponse } from "next/server";

import { resolveVenuePermalinkSlug, venueMapUrl } from "@/lib/venueIndex";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/**
 * Shared GET for `/venue/:slug` and `/pub/:slug`: map deep-link when the slug
 * resolves, branded 404 otherwise. No HTML page of its own.
 */
export async function venuePermalinkRedirect(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { slug: raw } = await context.params;
  const slug = decodeURIComponent(raw ?? "").trim();
  if (!slug) notFound();

  const venueId = await resolveVenuePermalinkSlug(slug);
  if (!venueId) notFound();

  const destination = new URL(venueMapUrl(venueId), request.url);
  return NextResponse.redirect(destination, 308);
}
