import "server-only";

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  creatorListDiscoveryDependencies,
  discoverCreatorLists,
  type CreatorListDiscoveryDependencies,
} from "@/lib/creatorListDiscovery.server";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;

export type CreatorListDiscoveryRouteDependencies = CreatorListDiscoveryDependencies & {
  isLimited(key: string, actor: string): Promise<boolean>;
  isStoreAvailable(): boolean;
};

const routeDependencies: CreatorListDiscoveryRouteDependencies = {
  ...creatorListDiscoveryDependencies,
  isLimited,
  isStoreAvailable: () =>
    !requiresSupabaseStore() || isSupabaseConfigured(),
};

export async function handleCreatorListDiscoveryRequest(
  request: Request,
  dependencies: CreatorListDiscoveryRouteDependencies = routeDependencies,
): Promise<Response> {
  const limiterKey = `creator-list-discovery:${hashIp(clientIp(request))}`;
  if (await dependencies.isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (!dependencies.isStoreAvailable()) {
    return publicApiError(
      "Creator lists are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return publicApiError(
        "Ask for 1 to 24 creators.",
        "INVALID_REQUEST",
        400,
      );
    }
    limit = parsed;
  }

  const afterHandle = normalizeHandle(params.get("after") ?? "");
  try {
    const result = await discoverCreatorLists(
      { limit, ...(afterHandle ? { afterHandle } : {}) },
      dependencies,
    );
    return jsonNoStore(result, { status: 200 });
  } catch {
    return publicApiError(
      "Creator lists are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
