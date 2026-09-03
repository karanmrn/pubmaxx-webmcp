import {
  handleProfileImageServe,
} from "@/lib/profileImageServe.server";
import { avatarServeRouteDeps } from "@/lib/profileImageServeRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleProfileImageServe(request, "avatar", await context.params, avatarServeRouteDeps());
}
