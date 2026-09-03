import "server-only";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const IMPORT_NOTES_RATE_LIMIT = 10;
const IMPORT_NOTES_RATE_WINDOW_MS = 60_000;

export async function isImportNotesLimited(request: Request): Promise<boolean> {
  const key = `import-notes:${hashIp(clientIp(request))}`;
  return isLimited(key, key, IMPORT_NOTES_RATE_LIMIT, IMPORT_NOTES_RATE_WINDOW_MS);
}
