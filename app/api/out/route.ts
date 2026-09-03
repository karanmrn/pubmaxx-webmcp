// GET /api/out?city=london&day=today|tomorrow|weekend
//
// Public Out listing. Events half is L2 (buildOutResponse: bundled file plus
// Ticketmaster / Skiddle). Open plans come from list_open_social_crews with
// city and time window in the RPC. A failed plans read is degraded, never an
// empty market.

import { publicApiError } from "@/lib/apiError";
import {
  boundOutOpenPlans,
  outPlansWindow,
  OUT_OPEN_PLAN_LIMIT,
} from "@/lib/out";
import { attachOpenPlanMeetingPoints } from "@/lib/openSocialCrew.server";
import { buildOutResponse, parseOutQuery } from "@/lib/out/loadOut";
import { outCacheControl } from "@/lib/out/outStatus";
import { isOutLimited } from "@/lib/outRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const maxDuration = 15;

const store = createSocialCrewStore();

export const GET = withRouteTiming("out", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isOutLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const url = new URL(request.url);
  const query = parseOutQuery(url.searchParams);
  if (!query) {
    return publicApiError("Unknown city or day.", "INVALID_REQUEST", 400);
  }

  const now = Date.now();
  const body = await buildOutResponse(query, { now });
  let status = body.status;
  const socialEnabled = isSocialFriendsLaunchEnabled(
    process.env[SOCIAL_FRIENDS_LAUNCH_ENV],
  );
  if (!socialEnabled) {
    return Response.json(
      {
        ...body,
        openPlans: null,
        openPlansStatus: "preview",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  let openPlans = body.openPlans;
  let openPlansStatus: "ready" | "degraded" = "ready";

  const window = outPlansWindow(query.day, now);
  try {
    const listed = await store.listOpen({
      from: window.from,
      until: window.until,
      city: query.city,
      limit: OUT_OPEN_PLAN_LIMIT,
    });
    const attached = await attachOpenPlanMeetingPoints(listed);
    if (attached.status === "degraded") {
      openPlansStatus = "degraded";
      if (status !== "degraded") status = "degraded";
    }
    openPlans = boundOutOpenPlans(attached.plans);
  } catch {
    openPlansStatus = "degraded";
    if (status === "ready") status = "degraded";
    openPlans = [];
  }

  return Response.json(
    { ...body, status, openPlans, openPlansStatus },
    {
      headers: { "cache-control": outCacheControl(status, body.venueMatch) },
    },
  );
}
