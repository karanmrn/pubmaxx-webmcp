import { parseEditorialSnapshot, type EditorialSnapshot } from "@/lib/editorial";
import { fetchPublicJson } from "@/lib/publicJsonLoader";

export const EDITORIAL_PATH = "/data/editorial/latest.json";

export async function loadEditorialSnapshot(): Promise<EditorialSnapshot> {
  const raw = await fetchPublicJson(EDITORIAL_PATH);
  return parseEditorialSnapshot(raw);
}
