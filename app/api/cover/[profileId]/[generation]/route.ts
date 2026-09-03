import { handleProfileImageServe } from "@/lib/profileImageServe.server";
import { coverServeRouteDeps } from "@/lib/profileImageServeRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageServe(request, "cover", await context.params, coverServeRouteDeps());
}
