import "server-only";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export async function isHandleClaimLimited(
  request: Request,
  userId: string,
): Promise<boolean> {
  const key = `handle-claim:${userId}:${hashIp(clientIp(request))}`;
  return isLimited(key, key, 20);
}
