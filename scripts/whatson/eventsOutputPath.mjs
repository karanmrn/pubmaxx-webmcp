// Where a city's What's-On events file lives, and nothing else.
//
// ONE leaf module because two independent lanes need the same answer:
// eventsRefresh.mjs writes the file, and the keyless Common reader joins its
// own rows into it. Common is spawned as its OWN command precisely so a quiet
// provider window cannot stop it, so it may not reach that path through
// eventsRefresh.mjs - whose graph now carries the TypeScript provider lane, and
// a load-time failure there would take Common down with it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function eventsOutputPath(city = "london") {
  return join(ROOT, "public", "data", "whats_on", `events_${city}.json`);
}
