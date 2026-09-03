import "server-only";

import { clientIp, hashActor, hashIp } from "@/lib/supabase";

/**
 * Device-derived identity for public reader reports and provisional-base
 * reads. Contributions use the authenticated profile actor instead. The raw IP
 * never leaves this function.
 */
export function deriveCommunityPriceActor(request: Request): string | undefined {
  try {
    return hashActor(`price-submit:${hashIp(clientIp(request))}`);
  } catch {
    return undefined;
  }
}
