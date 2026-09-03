// Own-user price trust impact. The personal contributions card is the only
// reader. Browser roles never see the tables; this route is the one seam.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { readPriceTrustImpact } from "@/lib/priceTrustImpact.server";

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError(
      "Sign in to view your price impact.",
      "UNAUTHENTICATED",
      401,
    );
  }
  try {
    return jsonNoStore(await readPriceTrustImpact(userId));
  } catch {
    return publicApiError(
      "Price impact is unavailable right now.",
      "UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
