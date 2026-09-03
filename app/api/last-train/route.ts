import { runLastTrainRoute } from "@/lib/lastTrain.server";

export const runtime = "nodejs";
// Nearest-station lookup and concurrent timetable reads can take several
// seconds from a serverless region.
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  return runLastTrainRoute(request);
}
