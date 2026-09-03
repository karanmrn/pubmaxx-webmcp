import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { code } = await context.params;
  const destination = new URL("/", request.url);
  destination.hash = new URLSearchParams({ referral: code }).toString();
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
