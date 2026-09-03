import "server-only";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

// IP-scoped (NOT per-code) to cap code enumeration: a per-code key would hand
// an enumerator a fresh budget for every guessed code, defeating the limiter's
// purpose. 120 guesses/min is nothing against a 28^6 code space, while the
// wider budget is roomy enough for a whole crew on shared pub wifi (one NAT IP)
// polling one round without tripping 429s.
const ROUNDS_READ_RATE_LIMIT = 120;
const ROUNDS_READ_RATE_WINDOW_MS = 60_000;

export async function isRoundsReadLimited(request: Request): Promise<boolean> {
  const key = `rounds-read:${hashIp(clientIp(request))}`;
  return isLimited(key, key, ROUNDS_READ_RATE_LIMIT, ROUNDS_READ_RATE_WINDOW_MS);
}
