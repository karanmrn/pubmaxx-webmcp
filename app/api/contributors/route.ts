import { jsonNoStore } from "@/lib/apiResponses";
import {
  enrichContributorBoard,
  readContributorLeaderboard,
} from "@/lib/contributorLeaderboardStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return jsonNoStore(await enrichContributorBoard(await readContributorLeaderboard()), {
    status: 200,
  });
}
